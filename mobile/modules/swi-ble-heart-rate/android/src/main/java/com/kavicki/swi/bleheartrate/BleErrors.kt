package com.kavicki.swi.bleheartrate

import expo.modules.kotlin.exception.CodedException

// Os códigos com que `scan` e `start` rejeitam. São os do contrato da ponte
// (SwiBleHeartRate.types.ts, BleHeartRateErrorCode): a tela mapeia cada um
// para o próprio texto.

internal class PermissionDeniedException(missing: String) :
  CodedException("E_PERMISSION_DENIED", "Permissão ausente: $missing", null)

internal class BluetoothOffException :
  CodedException("E_BLUETOOTH_OFF", "Bluetooth desligado", null)

internal class BluetoothUnavailableException :
  CodedException("E_BLUETOOTH_UNAVAILABLE", "Aparelho sem Bluetooth de baixa energia", null)

internal class StartFailedException(cause: Throwable?) :
  CodedException("E_START_FAILED", "O sistema recusou o serviço da pulseira", cause)
