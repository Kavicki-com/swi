package com.kavicki.swi.bleheartrate

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Os períodos em que a pulseira esteve conectada e com o 0x2A37 assinado. O
 * leitor do Health Connect descarta o batimento desses trechos, que já veio
 * pelo Bluetooth. Fica em arquivo para valer depois de o processo morrer.
 */
internal object ConnectedIntervals {
  private const val TAG = "SwiBleHeartRate"
  private const val FILE = "swi-ble-heart-rate-intervals.json"
  /** O leitor do Health Connect olha no máximo um dia para trás. */
  private const val KEEP_MS = 48L * 60 * 60 * 1000
  private val lock = Any()

  private data class Interval(val start: Long, val end: Long?)

  private fun file(ctx: Context) = File(ctx.filesDir, FILE)

  private fun read(ctx: Context): MutableList<Interval> {
    val f = file(ctx)
    if (!f.exists()) return mutableListOf()
    return try {
      val array = JSONArray(f.readText())
      MutableList(array.length()) { i ->
        val o = array.getJSONObject(i)
        Interval(o.getLong("start"), if (o.isNull("end")) null else o.getLong("end"))
      }
    } catch (e: Exception) {
      Log.w(TAG, "intervalos ilegiveis, recomecando", e)
      mutableListOf()
    }
  }

  private fun write(ctx: Context, list: List<Interval>, now: Long) {
    val kept = list.filter { it.end == null || it.end >= now - KEEP_MS }
    val array = JSONArray()
    kept.forEach { array.put(JSONObject().put("start", it.start).put("end", it.end ?: JSONObject.NULL)) }
    try {
      file(ctx).writeText(array.toString())
    } catch (e: Exception) {
      Log.w(TAG, "intervalos nao gravados", e)
    }
  }

  /** Abre um intervalo, se não houver um aberto. */
  fun open(ctx: Context, at: Long) = synchronized(lock) {
    val list = read(ctx)
    if (list.lastOrNull()?.end == null && list.isNotEmpty()) return@synchronized
    list.add(Interval(at, null))
    write(ctx, list, at)
  }

  /** Fecha o intervalo aberto, se houver, em `at` (nunca antes do começo). */
  fun close(ctx: Context, at: Long) = synchronized(lock) {
    val list = read(ctx)
    val last = list.lastOrNull() ?: return@synchronized
    if (last.end != null) return@synchronized
    list[list.size - 1] = last.copy(end = maxOf(at, last.start))
    write(ctx, list, at)
  }

  /**
   * Os que terminam depois de `sinceMs` ou seguem abertos. Com o serviço
   * parado, um intervalo aberto é sobra de um processo morto: vale até a
   * última leitura, e não até agora, para o Health Connect não perder o
   * batimento de um trecho em que o Bluetooth não trouxe nada.
   */
  fun since(ctx: Context, sinceMs: Long, serviceRunning: Boolean, lastReadingAt: Long?): List<Map<String, Any?>> =
    synchronized(lock) {
      read(ctx).mapNotNull { interval ->
        val end = interval.end
          ?: if (serviceRunning) null else maxOf(lastReadingAt ?: interval.start, interval.start)
        if (end != null && end <= sinceMs) return@mapNotNull null
        mapOf("start" to interval.start.toDouble(), "end" to end?.toDouble())
      }
    }
}
