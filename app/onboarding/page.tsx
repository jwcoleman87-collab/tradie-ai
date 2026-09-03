import type { Metadata } from 'next';
import Onboarding from '@/components/onboarding';

export const metadata: Metadata = {
  title: 'Workbench Chat — Workbench',
  description: 'Build a sourced first business profile with Workbench Chat.',
};

export default function OnboardingPage() {
  return <Onboarding />;
}
