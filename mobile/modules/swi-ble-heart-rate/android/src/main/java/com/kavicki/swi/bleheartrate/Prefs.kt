package com.kavicki.swi.bleheartrate

import android.content.Context
import android.content.SharedPreferences

/**
 * O que o serviço precisa para religar sozinho depois de o sistema matar o
 * processo: o endereço da pulseira escolhida, o nome que ela anuncia (para
 * achá-la de novo se o endereço aleatório girar) e o tipo do endereço.
 */
internal object Prefs {
  private const val FILE = "swi_ble_heart_rate"
  private const val KEY_DEVICE = "deviceId"
  private const val KEY_NAME = "name"
  private const val KEY_ADDRESS_TYPE = "addressType"
  private const val KEY_LAST_READING = "lastReadingAt"

  /** Tipo do endereço desconhecido: o Android só o informa do 15 em diante. */
  const val ADDRESS_TYPE_UNKNOWN = -1

  private fun prefs(ctx: Context): SharedPreferences =
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun device(ctx: Context): String? = prefs(ctx).getString(KEY_DEVICE, null)

  fun name(ctx: Context): String? = prefs(ctx).getString(KEY_NAME, null)

  fun addressType(ctx: Context): Int = prefs(ctx).getInt(KEY_ADDRESS_TYPE, ADDRESS_TYPE_UNKNOWN)

  fun saveDevice(ctx: Context, address: String, name: String?, addressType: Int) {
    prefs(ctx).edit()
      .putString(KEY_DEVICE, address)
      .putString(KEY_NAME, name)
      .putInt(KEY_ADDRESS_TYPE, addressType)
      .apply()
  }

  fun lastReadingAt(ctx: Context): Long? =
    prefs(ctx).getLong(KEY_LAST_READING, 0L).takeIf { it > 0L }

  fun saveLastReading(ctx: Context, at: Long) {
    prefs(ctx).edit().putLong(KEY_LAST_READING, at).apply()
  }
}
