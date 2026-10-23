package com.kavicki.swi.bleheartrate

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

/**
 * O lado nativo da ponte (modules/swi-ble-heart-rate/src). Nomes, formas e
 * códigos de erro seguem o contrato de SwiBleHeartRate.types.ts: um nome
 * errado aqui faz o invólucro descartar tudo sem erro.
 */
@SuppressLint("MissingPermission")
class SwiBleHeartRateModule : Module() {
  private companion object {
    const val TAG = "SwiBleHeartRate"
  }

  private data class Seen(val name: String?, val addressType: Int)

  /** O que a varredura viu, para o `start` guardar nome e tipo do endereço. */
  private val seen = ConcurrentHashMap<String, Seen>()
  @Volatile private var scanCallback: ScanCallback? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SwiBleHeartRate")

    Events("onScanResult", "onStateChanged")

    OnCreate {
      BleHeartRateService.stateListener = { event -> sendEvent("onStateChanged", event) }
    }

    OnDestroy {
      BleHeartRateService.stateListener = null
      stopScanQuietly()
    }

    AsyncFunction("scan") {
      val ctx = context
      val adapter = adapterOrThrow(ctx)
      requireScanPermission(ctx)
      if (!adapter.isEnabled) throw BluetoothOffException()
      val scanner = adapter.bluetoothLeScanner ?: throw BluetoothOffException()
      stopScanQuietly()
      val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) = report(result)

        override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach(::report)

        override fun onScanFailed(errorCode: Int) {
          Log.w(TAG, "varredura da tela falhou codigo=$errorCode")
        }
      }
      val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(BleHeartRateService.HEART_RATE_SERVICE)).build()
      val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
      scanner.startScan(listOf(filter), settings, callback)
      scanCallback = callback
    }

    Function("stopScan") {
      stopScanQuietly()
    }

    AsyncFunction("start") { deviceId: String ->
      val ctx = context
      adapterOrThrow(ctx)
      // No Android 14 o serviço `connectedDevice` sem BLUETOOTH_CONNECT
      // derrubaria o app ao subir: confere antes e rejeita com o código.
      if (!BleHeartRateService.canConnect(ctx)) throw PermissionDeniedException("BLUETOOTH_CONNECT")
      // A tela pede de novo a cada volta ao app, sempre com o endereço da
      // escolha. A mesma escolha não regrava nada: o serviço pode estar
      // seguindo a pulseira num endereço que girou, e o da escolha já não
      // existe. Só uma escolha nova troca a pulseira guardada.
      if (Prefs.device(ctx) != deviceId) {
        val fromScan = seen[deviceId]
        Prefs.saveDevice(ctx, deviceId, fromScan?.name, fromScan?.addressType ?: Prefs.ADDRESS_TYPE_UNKNOWN)
      }
      try {
        BleHeartRateService.start(ctx)
      } catch (e: Exception) {
        // Pedido com o app fora da tela: o sistema não deixa nascer serviço
        // em primeiro plano daí.
        throw StartFailedException(e)
      }
    }

    AsyncFunction("stop") {
      BleHeartRateService.stop(context)
    }

    Function("rotateReadings") {
      Inbox.rotate(context)
    }

    Function("connectedIntervals") { sinceMs: Double ->
      val ctx = context
      ConnectedIntervals.since(ctx, sinceMs.toLong(), BleHeartRateService.running, Prefs.lastReadingAt(ctx))
    }

    Function("status") {
      val ctx = context
      mapOf(
        "state" to if (BleHeartRateService.running) BleHeartRateService.state else BleHeartRateService.STATE_IDLE,
        "deviceId" to Prefs.device(ctx),
        "lastReadingAt" to Prefs.lastReadingAt(ctx)?.toDouble(),
      )
    }
  }

  private fun report(result: ScanResult) {
    val device = result.device
    val name = result.scanRecord?.deviceName ?: try {
      device.name
    } catch (e: SecurityException) {
      null
    }
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      device.addressType
    } else {
      Prefs.ADDRESS_TYPE_UNKNOWN
    }
    seen[device.address] = Seen(name, type)
    sendEvent("onScanResult", mapOf("deviceId" to device.address, "name" to name, "rssi" to result.rssi))
  }

  private fun stopScanQuietly() {
    val callback = scanCallback ?: return
    scanCallback = null
    try {
      appContext.reactContext?.let { adapterOf(it)?.bluetoothLeScanner?.stopScan(callback) }
    } catch (e: Exception) {
      Log.w(TAG, "varredura da tela nao parou", e)
    }
  }

  private fun adapterOf(ctx: Context): BluetoothAdapter? =
    ctx.getSystemService(BluetoothManager::class.java)?.adapter

  private fun adapterOrThrow(ctx: Context): BluetoothAdapter {
    if (!ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
      throw BluetoothUnavailableException()
    }
    return adapterOf(ctx) ?: throw BluetoothUnavailableException()
  }

  private fun requireScanPermission(ctx: Context) {
    val needed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    val missing = needed.filter { ctx.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
    if (missing.isNotEmpty()) throw PermissionDeniedException(missing.joinToString())
  }
}
