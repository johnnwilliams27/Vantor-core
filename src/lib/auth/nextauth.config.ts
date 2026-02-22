import CredentialsProvider from 'next-auth/providers/credentials';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NextAuthOptions } from 'next-auth';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const supabase = createAdminClient();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        });
        if (error || !data.user) return null;

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        return {
          id: data.user.id,
          email: data.user.email!,
          name: profile?.full_name ?? data.user.email,
          role: profile?.role ?? 'auditor',
          onboarding_done: profile?.onboarding_done ?? false,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? 'auditor';
        token.onboarding_done =
          (user as { onboarding_done?: boolean }).onboarding_done ?? false;
      }
      // Re-fetch from DB whenever the session is explicitly updated
      // (e.g. after completing onboarding)
      if (trigger === 'update' && token.id) {
        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role, onboarding_done')
          .eq('id', token.id)
          .single();
        if (profile) {
          token.role = profile.role;
          token.onboarding_done = profile.onboarding_done;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.onboarding_done = token.onboarding_done as boolean;
      }
      return session;
    },
  },
};

// Extend next-auth types
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: string;
      onboarding_done: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    onboarding_done: boolean;
  }
}
