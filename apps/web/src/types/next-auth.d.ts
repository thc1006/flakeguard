import NextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    provider?: string;
  }

  interface JWT {
    accessToken?: string;
    provider?: string;
  }
}
