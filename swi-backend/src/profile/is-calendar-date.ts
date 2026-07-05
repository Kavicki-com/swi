import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator'

// Valida que a string é uma data YYYY-MM-DD que EXISTE no calendário.
// `new Date('YYYY-MM-DD')` parseia como UTC midnight; toISOString() é UTC →
// o round-trip slice(0,10) compara sem drift de timezone. Datas impossíveis
// (2000-13-45 → Invalid Date; 2000-02-30 → rola pra 03-01) não round-trip.
export function IsCalendarDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
          const d = new Date(value)
          return !Number.isNaN(d.getTime()) && value === d.toISOString().slice(0, 10)
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} deve ser uma data de calendário válida (YYYY-MM-DD)`
        },
      },
    })
  }
}
