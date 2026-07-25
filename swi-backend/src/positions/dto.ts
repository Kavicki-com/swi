import { IsNumber, Max, Min } from 'class-validator'

export class HeartbeatDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number
  @IsNumber() @Min(-180) @Max(180) lng!: number
}
