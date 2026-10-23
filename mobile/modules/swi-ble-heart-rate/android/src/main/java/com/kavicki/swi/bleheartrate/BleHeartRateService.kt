package com.kavicki.swi.bleheartrate

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import java.util.UUID

/**
 * Serviço em primeiro plano que mantém a pulseira escolhida conectada, assina
 * o 0x2A37 e grava cada notificação crua na caixa de entrada. A cada 15 s com
 * leitura nova acorda a tarefa JS sem interface, que drena a caixa. Não
 * interpreta nada.
 *
 * Sobe pelo `start` do módulo, com o app na tela (o sistema não deixa um
 * serviço em primeiro plano nascer do segundo plano). Depois disso o
 * `START_STICKY` faz o sistema relançá-lo sozinho se matar o processo, até o
 * `stop`.
 *
 * Como conecta, pelo que a viabilidade provou nos emuladores:
 * - endereço público: conexão em segundo plano (`autoConnect`), que o próprio
 *   sistema completa quando a pulseira volta ao alcance; queda normal rearma
 *   com `gatt.connect()`;
 * - endereço aleatório, ou tipo desconhecido que o sistema recusou: o
 *   `autoConnect` é recusado na hora (status 135). Aí o serviço varre pelo
 *   0x180D e conecta direto no aparelho achado, que carrega o tipo certo do
 *   endereço. Se o endereço aleatório girou, acha a pulseira pelo nome;
 * - nunca tenta de novo sem espera: cada recusa espera de 5 s a 30 s.
 */
@SuppressLint("MissingPermission")
class BleHeartRateService : Service() {

  companion object {
    private const val TAG = "SwiBleHeartRate"
    private const val CHANNEL = "swi-ble-heart-rate"
    private const val NOTIFICATION_ID = 7341
    private const val NOTIFICATION_TEXT =
      "O monitoramento segue ligado. Para encerrar, toque em Encerrar no SWI, em Configurações, Monitoramento."
    private const val KICK_INTERVAL_MS = 15_000L
    private const val RETRY_MIN_MS = 5_000L
    private const val RETRY_MAX_MS = 30_000L
    private const val RESCAN_WINDOW_MS = 20_000L

    val HEART_RATE_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
    private val HEART_RATE_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
    private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    // Quedas em que a conexão em segundo plano só precisa ser rearmada:
    // 0 desconexão pedida, 8 fora de alcance, 19 a pulseira encerrou.
    private val NORMAL_DROPS = setOf(BluetoothGatt.GATT_SUCCESS, 8, 19)

    const val STATE_IDLE = "idle"
    const val STATE_SEARCHING = "searching"
    const val STATE_CONNECTED = "connected"
    const val STATE_BLUETOOTH_OFF = "bluetoothOff"

    @Volatile var state: String = STATE_IDLE
      private set
    @Volatile var running = false
      private set

    /** O módulo ouve aqui para emitir `onStateChanged`. */
    @Volatile var stateListener: ((Map<String, Any?>) -> Unit)? = null

    fun start(ctx: Context) {
      ctx.startForegroundService(Intent(ctx, BleHeartRateService::class.java))
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, BleHeartRateService::class.java))
    }

    /** Sem BLUETOOTH_CONNECT, o Android 14 derruba o serviço `connectedDevice` ao subir. */
    fun canConnect(ctx: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
  }

  private val handler = Handler(Looper.getMainLooper())
  private var gatt: BluetoothGatt? = null
  private var address: String? = null
  private var usingAutoConnect = false
  /** O sistema recusou o `autoConnect` para esta pulseira nesta vida do serviço. */
  private var autoRefused = false
  private var subscribed = false
  private var retryDelay = RETRY_MIN_MS
  private var rescan: ScanCallback? = null
  @Volatile private var lastKickAt = 0L
  private var receiverRegistered = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "Batimento pela pulseira", NotificationManager.IMPORTANCE_LOW),
    )
    try {
      if (!canConnect(this)) throw SecurityException("BLUETOOTH_CONNECT ausente")
      val notification = notification("Procurando pulseira")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Permissão revogada entre um relançamento e outro: sem ela o serviço
      // não pode existir. Para em vez de derrubar o app. Parar sem
      // startForeground só derrubaria quem subiu por startForegroundService,
      // e esse caminho (o `start` do módulo) confere a permissão antes; o
      // relançamento do START_STICKY não cobra o startForeground (provado no
      // Android 16: permissão revogada, relançado em 1 s, parou sem erro).
      Log.w(TAG, "servico nao subiu", e)
      stopSelf()
      return
    }
    running = true
    // Intervalo que ficou aberto quando o processo morreu: termina na última
    // leitura que chegou, não agora.
    ConnectedIntervals.close(this, Prefs.lastReadingAt(this) ?: 0L)
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(adapterReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(adapterReceiver, filter)
    }
    receiverRegistered = true
    Log.i(TAG, "servico criado")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!running) return START_NOT_STICKY
    val stored = Prefs.address(this)
    if (stored == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    Log.i(TAG, "onStartCommand relancado=${intent == null}")
    if (stored != address) {
      // Primeira subida, ou outra pulseira escolhida com o serviço de pé. O
      // endereço que girou com o serviço de pé já é o guardado: não religa.
      teardownGatt()
      stopRescan()
      handler.removeCallbacks(recover)
      address = stored
      autoRefused = false
      retryDelay = RETRY_MIN_MS
      connectNow()
    }
    handler.removeCallbacks(kickLoop)
    handler.postDelayed(kickLoop, KICK_INTERVAL_MS)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    if (running) {
      stopRescan()
      teardownGatt()
      ConnectedIntervals.close(this, System.currentTimeMillis())
      if (receiverRegistered) unregisterReceiver(adapterReceiver)
      receiverRegistered = false
      running = false
      publish(STATE_IDLE)
      // A última drenagem leva o resto da caixa. Parado pela tela (Encerrar,
      // logout), o app está na frente e a tarefa sobe. Parado pela própria
      // drenagem (pulseira encerrada, aparelho despareado), o que sobrou
      // chegou depois do fim da sessão: a drenagem o descarta se a tarefa
      // subir, e se o sistema recusar o pedido (app em segundo plano) o resto
      // fica na caixa e a próxima escolha o descarta pela hora.
      if (Inbox.hasPending(this)) kick(System.currentTimeMillis())
    }
    Log.i(TAG, "servico destruido")
    super.onDestroy()
  }

  private fun adapter(): BluetoothAdapter? = getSystemService(BluetoothManager::class.java)?.adapter

  private fun publish(next: String) {
    if (state == next) return
    state = next
    val deviceId = if (next == STATE_IDLE) null else Prefs.device(this)
    try {
      stateListener?.invoke(
        mapOf("state" to next, "deviceId" to deviceId, "changedAt" to System.currentTimeMillis().toDouble()),
      )
    } catch (e: Exception) {
      Log.w(TAG, "estado nao emitido", e)
    }
    when (next) {
      STATE_CONNECTED -> updateNotification(
        Prefs.name(this)?.let { "Monitorando batimento · $it" } ?: "Monitorando batimento",
      )
      STATE_SEARCHING -> updateNotification("Procurando pulseira")
      STATE_BLUETOOTH_OFF -> updateNotification("Bluetooth desligado")
    }
  }

  // Fica visível enquanto a escuta estiver ligada, também fora do expediente:
  // é ela que lembra que o monitoramento segue ligado e diz como encerrar.
  private fun notification(title: String): Notification {
    val builder = Notification.Builder(this, CHANNEL)
      .setContentTitle(title)
      .setContentText(NOTIFICATION_TEXT)
      .setStyle(Notification.BigTextStyle().bigText(NOTIFICATION_TEXT))
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
    }
    return builder.build()
  }

  private fun updateNotification(title: String) {
    if (!running) return
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(title))
  }

  // ----- conexão -----

  private fun connectNow() {
    val adapter = adapter()
    if (adapter == null || !adapter.isEnabled) {
      publish(STATE_BLUETOOTH_OFF)
      return
    }
    publish(STATE_SEARCHING)
    val target = address ?: return
    val type = Prefs.addressType(this)
    val auto = !autoRefused && (type == BluetoothDevice.ADDRESS_TYPE_PUBLIC || type == Prefs.ADDRESS_TYPE_UNKNOWN)
    if (!auto) {
      // Endereço aleatório: a conexão direta só vale para quem acabou de
      // anunciar, então começa pela varredura.
      startRescan()
      return
    }
    // getRemoteDevice(endereço) assume endereço público; com o tipo conhecido
    // (Android 15 em diante guarda o da varredura) o aparelho nasce certo.
    val device = if (type != Prefs.ADDRESS_TYPE_UNKNOWN && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      adapter.getRemoteLeDevice(target, type)
    } else {
      adapter.getRemoteDevice(target)
    }
    connectDevice(device, autoConnect = true)
  }

  private fun connectDevice(device: BluetoothDevice, autoConnect: Boolean) {
    teardownGatt()
    usingAutoConnect = autoConnect
    Log.i(TAG, "conectando ${device.address} autoConnect=$autoConnect")
    gatt = device.connectGatt(this, autoConnect, callback, BluetoothDevice.TRANSPORT_LE)
  }

  /** Fecha o GATT e o intervalo conectado, se houver. */
  private fun teardownGatt() {
    gatt?.let {
      try {
        it.close()
      } catch (e: Exception) {
        Log.w(TAG, "gatt nao fechou", e)
      }
    }
    gatt = null
    if (subscribed) ConnectedIntervals.close(this, System.currentTimeMillis())
    subscribed = false
    Prefs.flushLastReading(this)
  }

  private val recover = Runnable { if (running) startRescan() }

  private fun scheduleRecover() {
    handler.removeCallbacks(recover)
    handler.postDelayed(recover, retryDelay)
    retryDelay = minOf(retryDelay * 2, RETRY_MAX_MS)
  }

  private fun startRescan() {
    if (rescan != null) return
    val adapter = adapter()
    val scanner = adapter?.bluetoothLeScanner
    if (adapter == null || !adapter.isEnabled || scanner == null) {
      publish(STATE_BLUETOOTH_OFF)
      return
    }
    publish(STATE_SEARCHING)
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        handler.post { onRescanResult(result) }
      }

      override fun onScanFailed(errorCode: Int) {
        Log.w(TAG, "varredura falhou codigo=$errorCode")
        handler.post {
          rescan = null
          scheduleRecover()
        }
      }
    }
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(HEART_RATE_SERVICE)).build()
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    try {
      scanner.startScan(listOf(filter), settings, callback)
      rescan = callback
      handler.postDelayed(rescanTimeout, RESCAN_WINDOW_MS)
    } catch (e: Exception) {
      // Sem permissão de varrer (localização no Android 8 a 11): tenta a
      // conexão direta pelo endereço guardado, com espera.
      Log.w(TAG, "varredura recusada, conexao direta", e)
      address?.let { connectDevice(adapter.getRemoteDevice(it), autoConnect = false) }
    }
  }

  private val rescanTimeout = Runnable {
    if (rescan != null) {
      Log.i(TAG, "pulseira nao apareceu na varredura")
      stopRescan()
      scheduleRecover()
    }
  }

  private fun stopRescan() {
    handler.removeCallbacks(rescanTimeout)
    val callback = rescan ?: return
    rescan = null
    try {
      adapter()?.bluetoothLeScanner?.stopScan(callback)
    } catch (e: Exception) {
      Log.w(TAG, "varredura nao parou", e)
    }
  }

  private fun onRescanResult(result: ScanResult) {
    if (rescan == null) return
    val found = result.device
    val storedName = Prefs.name(this)
    val sameAddress = found.address == address
    val announced = result.scanRecord?.deviceName
    // Endereço aleatório que girou: a mesma pulseira volta com outro endereço
    // e o mesmo nome. Endereço público nunca muda, então não troca por nome.
    val sameName = !sameAddress && storedName != null && announced == storedName &&
      Prefs.addressType(this) != BluetoothDevice.ADDRESS_TYPE_PUBLIC
    if (!sameAddress && !sameName) return
    stopRescan()
    if (sameName) {
      Log.i(TAG, "endereco girou, seguindo a pulseira pelo nome")
      address = found.address
      Prefs.followAddress(this, found.address, addressTypeOf(found))
    }
    // O aparelho da varredura já traz o tipo do endereço: conexão direta.
    connectDevice(found, autoConnect = false)
  }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      handler.post { onConnectionChange(g, status, newState) }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      handler.post { subscribe(g, status) }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      handler.post {
        if (g !== gatt || descriptor.uuid != CCCD) return@post
        if (status != BluetoothGatt.GATT_SUCCESS) {
          Log.w(TAG, "assinatura recusada status=$status")
          g.disconnect()
          return@post
        }
        subscribed = true
        retryDelay = RETRY_MIN_MS
        ConnectedIntervals.open(this@BleHeartRateService, System.currentTimeMillis())
        publish(STATE_CONNECTED)
      }
    }

    // Android 13 em diante entrega o valor no argumento; a característica
    // não carrega mais o valor.
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
      onReading(c, value)
    }

    @Deprecated("Até o Android 12")
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
      @Suppress("DEPRECATION")
      c.value?.let { onReading(c, it) }
    }
  }

  private fun onConnectionChange(g: BluetoothGatt, status: Int, newState: Int) {
    if (g !== gatt) {
      // Resposta de um GATT já trocado por outro.
      g.close()
      return
    }
    Log.i(TAG, "conexao status=$status estado=$newState")
    if (newState == BluetoothProfile.STATE_CONNECTED) {
      g.discoverServices()
      return
    }
    if (newState != BluetoothProfile.STATE_DISCONNECTED) return

    if (subscribed) ConnectedIntervals.close(this, System.currentTimeMillis())
    subscribed = false
    Prefs.flushLastReading(this)
    val adapter = adapter()
    if (adapter == null || !adapter.isEnabled) {
      teardownGatt()
      publish(STATE_BLUETOOTH_OFF)
      return
    }
    publish(STATE_SEARCHING)
    if (usingAutoConnect && status in NORMAL_DROPS) {
      // Fora de alcance ou desligada: o sistema completa a conexão sozinho
      // quando a pulseira voltar a anunciar.
      g.connect()
      return
    }
    // Recusa, ou conexão direta que esgotou: fecha, e procura de novo com
    // espera. Uma recusa do autoConnect vale para o resto desta vida.
    if (usingAutoConnect) autoRefused = true
    teardownGatt()
    scheduleRecover()
  }

  private fun subscribe(g: BluetoothGatt, status: Int) {
    if (g !== gatt) return
    val characteristic = g.getService(HEART_RATE_SERVICE)?.getCharacteristic(HEART_RATE_MEASUREMENT)
    val descriptor = characteristic?.getDescriptor(CCCD)
    if (characteristic == null || descriptor == null) {
      Log.w(TAG, "0x2A37 ausente status=$status")
      g.disconnect()
      return
    }
    g.setCharacteristicNotification(characteristic, true)
    val value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeDescriptor(descriptor, value)
    } else {
      @Suppress("DEPRECATION")
      descriptor.value = value
      @Suppress("DEPRECATION")
      g.writeDescriptor(descriptor)
    }
  }

  private fun onReading(c: BluetoothGattCharacteristic, value: ByteArray) {
    if (c.uuid != HEART_RATE_MEASUREMENT) return
    val now = System.currentTimeMillis()
    Inbox.append(this, value, now)
    Prefs.noteReading(this, now)
    if (now - lastKickAt >= KICK_INTERVAL_MS) {
      // Marcado aqui, na thread da notificação: a próxima notificação já vê
      // a marca e não agenda outro disparo.
      lastKickAt = now
      handler.post { kick(now) }
    }
  }

  // ----- Bluetooth do celular -----

  private val adapterReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
        BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> handler.post {
          handler.removeCallbacks(recover)
          stopRescan()
          teardownGatt()
          publish(STATE_BLUETOOTH_OFF)
        }
        BluetoothAdapter.STATE_ON -> handler.post {
          retryDelay = RETRY_MIN_MS
          connectNow()
        }
      }
    }
  }

  // ----- drenagem -----

  // Rede de segurança para quando as notificações param: drena o que sobrou.
  private val kickLoop = object : Runnable {
    override fun run() {
      if (Inbox.hasPending(this@BleHeartRateService)) kick(System.currentTimeMillis())
      handler.postDelayed(this, KICK_INTERVAL_MS)
    }
  }

  private fun kick(now: Long) {
    lastKickAt = now
    try {
      startService(Intent(this, BleDrainTaskService::class.java))
    } catch (e: Exception) {
      Log.w(TAG, "tarefa JS nao iniciou", e)
      return
    }
    // Só depois de o sistema aceitar o pedido: a trava não tem prazo e quem a
    // solta é o fim do BleDrainTaskService. Com o pedido recusado ela ficaria
    // presa, com a CPU acordada até o serviço subir de novo. Até a tarefa começar
    // (ela pega a mesma trava) este código segue na thread principal, onde o
    // serviço também nasce, então a trava chega antes dele.
    HeadlessJsTaskService.acquireWakeLockNow(this)
  }

  private fun addressTypeOf(device: BluetoothDevice): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) device.addressType else Prefs.ADDRESS_TYPE_UNKNOWN
}
