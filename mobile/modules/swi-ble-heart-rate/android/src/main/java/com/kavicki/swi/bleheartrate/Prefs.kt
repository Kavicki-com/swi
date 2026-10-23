package com.kavicki.swi.bleheartrate

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64

/**
 * O que o serviço precisa para religar sozinho depois de o sistema matar o
 * processo: a pulseira escolhida, o endereço em que ela está agora, o nome
 * que ela anuncia (para achá-la de novo se o endereço aleatório girar) e o
 * tipo do endereço.
 *
 * A escolha e o endereço atual ficam separados. A escolha é o endereço que a
 * tela guardou e passa ao `start` a cada volta ao app; o endereço atual é o
 * que o serviço segue depois de um giro. Gravar a escolha por cima do
 * endereço atual mandaria o serviço para um endereço que não existe mais.
 */
internal object Prefs {
  private const val FILE = "swi_ble_heart_rate"
  private const val KEY_DEVICE = "deviceId"
  private const val KEY_ADDRESS = "address"
  private const val KEY_NAME = "name"
  private const val KEY_ADDRESS_TYPE = "addressType"
  private const val KEY_LAST_READING = "lastReadingAt"

  /** Tipo do endereço desconhecido: o Android só o informa do 15 em diante. */
  const val ADDRESS_TYPE_UNKNOWN = -1

  private fun prefs(ctx: Context): SharedPreferences =
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  /** A pulseira escolhida, como a tela a conhece (o endereço da escolha). */
  fun device(ctx: Context): String? = prefs(ctx).getString(KEY_DEVICE, null)

  /** O endereço em que a pulseira está agora; o da escolha até o primeiro giro. */
  fun address(ctx: Context): String? = prefs(ctx).getString(KEY_ADDRESS, null) ?: device(ctx)

  fun name(ctx: Context): String? = prefs(ctx).getString(KEY_NAME, null)

  fun addressType(ctx: Context): Int = prefs(ctx).getInt(KEY_ADDRESS_TYPE, ADDRESS_TYPE_UNKNOWN)

  /** Escolha nova: o endereço atual volta a ser o da escolha. */
  fun saveDevice(ctx: Context, deviceId: String, name: String?, addressType: Int) {
    prefs(ctx).edit()
      .putString(KEY_DEVICE, deviceId)
      .putString(KEY_ADDRESS, deviceId)
      .putString(KEY_NAME, name)
      .putInt(KEY_ADDRESS_TYPE, addressType)
      .apply()
  }

  /** O endereço girou: a escolha e o nome ficam, muda só onde ela está. */
  fun followAddress(ctx: Context, address: String, addressType: Int) {
    prefs(ctx).edit()
      .putString(KEY_ADDRESS, address)
      .putInt(KEY_ADDRESS_TYPE, addressType)
      .apply()
  }

  /**
   * A pulseira notifica uma vez por segundo. A hora da última leitura fica em
   * memória e vai para o disco no máximo uma vez a cada 15 s (cada gravação
   * reescreve o arquivo inteiro). Processo morto perde no máximo esses 15 s.
   *
   * Os bytes da última notificação ficam só em memória, para a tela de
   * escolher a pulseira mostrar o valor que acabou de chegar. Processo morto
   * volta sem eles, e a tela espera a próxima notificação.
   */
  private const val PERSIST_EVERY_MS = 15_000L
  @Volatile private var lastReadingInMemory = 0L
  @Volatile private var lastReadingPersisted = 0L
  @Volatile private var lastBytesInMemory: ByteArray? = null

  fun lastReadingAt(ctx: Context): Long? =
    maxOf(lastReadingInMemory, prefs(ctx).getLong(KEY_LAST_READING, 0L)).takeIf { it > 0L }

  /** Bytes da última notificação em base64; null antes da primeira neste processo. */
  fun lastBytes(): String? = lastBytesInMemory?.let { Base64.encodeToString(it, Base64.NO_WRAP) }

  fun noteReading(ctx: Context, at: Long, bytes: ByteArray) {
    // Cópia: no Android antigo o vetor é o da característica, que o sistema
    // reaproveita na notificação seguinte.
    lastBytesInMemory = bytes.copyOf()
    lastReadingInMemory = at
    if (at - lastReadingPersisted >= PERSIST_EVERY_MS) persistLastReading(ctx, at)
  }

  /** Grava a hora em memória, se o disco estiver atrás dela. */
  fun flushLastReading(ctx: Context) {
    val at = lastReadingInMemory
    if (at > lastReadingPersisted) persistLastReading(ctx, at)
  }

  private fun persistLastReading(ctx: Context, at: Long) {
    lastReadingPersisted = at
    prefs(ctx).edit().putLong(KEY_LAST_READING, at).apply()
  }
}
