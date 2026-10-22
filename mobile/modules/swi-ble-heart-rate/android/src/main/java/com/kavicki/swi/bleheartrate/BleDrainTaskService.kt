package com.kavicki.swi.bleheartrate

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Roda a drenagem da caixa de entrada em JavaScript, com ou sem tela aberta
 * (registerBluetoothDrainTask.ts registra a tarefa pelo mesmo nome). Com uma
 * HeadlessJsTask em curso o React Native mantém os timers vivos, e a tarefa
 * pode rodar com o app em primeiro plano.
 */
class BleDrainTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), TIMEOUT_MS, true)

  companion object {
    const val TASK_NAME = "SwiBleHeartRateDrain"
    private const val TIMEOUT_MS = 30_000L
  }
}
