import type { Metadata } from 'next';
import Onboarding from '@/components/onboarding';

export const metadata: Metadata = {
  title: 'Meet Magic — Workbench',
  description: 'Build a sourced first business profile with Magic.',
};

export default function OnboardingPage() {
  return <Onboarding />;
}
