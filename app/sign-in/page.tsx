import type { Metadata } from 'next';
import SignIn from '@/components/sign-in';

export const metadata: Metadata = {
  title: 'Sign in — Workbench',
  description: 'Sign in to your private Workbench workspace.',
};

export default function SignInPage() {
  return <SignIn />;
}
