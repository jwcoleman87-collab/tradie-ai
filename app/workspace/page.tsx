import type { Metadata } from 'next';
import Workspace from '@/components/workspace';

export const metadata: Metadata = {
  title: 'Workspace — Workbench',
  description: 'Your private Workbench workspace.',
};

export default function WorkspacePage() {
  return <Workspace />;
}
