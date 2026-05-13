import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MemberRole } from '@prisma/client';

export class InviteMemberDto {
  @ApiProperty({ example: 'colleague@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: MemberRole, example: MemberRole.MEMBER })
  @IsEnum(MemberRole)
  role: MemberRole;

  // Optional. When the email doesn't match an existing user, this creates
  // the user record with the provided password and then adds them as a
  // member of the org. When omitted, the endpoint returns 404 if the user
  // doesn't exist yet (existing behavior). Promotion to OWNER is rejected
  // by the service regardless of this DTO.
  @ApiPropertyOptional({
    minLength: 8,
    description: 'Initial password for a brand-new user. Required only when the email is not yet registered.',
  })
  @IsOptional() @IsString() @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ example: 'Demo User' })
  @IsOptional() @IsString() @MinLength(1)
  name?: string;
}
