package com.kavicki.swi.bleheartrate

import android.content.Context
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * Caixa de entrada das notificações do 0x2A37: uma linha JSON por
 * notificação, com os bytes crus em base64 e a hora do recebimento. Quem
 * interpreta é o JavaScript (heartRateMeasurement.ts).
 *
 * A rotação renomeia o arquivo antes de ler, como a caixa do relógio no
 * iPhone: uma notificação que chega durante a leitura vai para um arquivo
 * novo, e um processo morto no meio deixa o arquivo renomeado, que a próxima
 * rotação entrega primeiro.
 */
internal object Inbox {
  private const val TAG = "SwiBleHeartRate"
  private const val FILE = "swi-ble-heart-rate-inbox.ndjson"
  private const val ROTATING = "swi-ble-heart-rate-inbox.rotating.ndjson"
  private val lock = Any()

  private fun file(ctx: Context, name: String) = File(ctx.filesDir, name)

  fun append(ctx: Context, bytes: ByteArray, receivedAt: Long) = synchronized(lock) {
    val line = JSONObject()
      .put("bytes", Base64.encodeToString(bytes, Base64.NO_WRAP))
      .put("receivedAt", receivedAt)
    try {
      file(ctx, FILE).appendText(line.toString() + "\n")
    } catch (e: Exception) {
      Log.w(TAG, "leitura nao gravada na caixa", e)
    }
  }

  fun hasPending(ctx: Context): Boolean = synchronized(lock) {
    file(ctx, FILE).length() > 0L || file(ctx, ROTATING).exists()
  }

  /** Devolve tudo o que está na caixa, na ordem de chegada, e a esvazia. */
  fun rotate(ctx: Context): List<Map<String, Any>> = synchronized(lock) {
    val inbox = file(ctx, FILE)
    val rotating = file(ctx, ROTATING)
    try {
      if (inbox.exists()) {
        if (rotating.exists()) {
          rotating.appendText(inbox.readText())
          inbox.delete()
        } else if (!inbox.renameTo(rotating)) {
          return emptyList()
        }
      }
      if (!rotating.exists()) return emptyList()
      val rows = rotating.readLines().mapNotNull(::parse)
      rotating.delete()
      rows
    } catch (e: Exception) {
      Log.w(TAG, "caixa ilegivel nesta rodada", e)
      emptyList()
    }
  }

  // Linha torta (gravação cortada por falta de espaço, por exemplo) é pulada:
  // o resto da caixa não paga por ela.
  private fun parse(line: String): Map<String, Any>? = runCatching {
    val json = JSONObject(line)
    mapOf<String, Any>(
      "bytes" to json.getString("bytes"),
      "receivedAt" to json.getLong("receivedAt").toDouble(),
    )
  }.getOrNull()
}
