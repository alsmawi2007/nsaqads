export interface JwtPayload {
  sub: string;   // user ID
  email: string;
  isSystemAdmin: boolean;
}

export interface JwtRefreshPayload {
  sub: string;
  tokenId: string;
}
