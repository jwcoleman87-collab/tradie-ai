import type { ComponentProps } from 'react';
import { Button as BaseButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Use the installed accessible button, with one Workbench measurement scale. */
export function Button({
  size = 'default',
  ...props
}: ComponentProps<typeof BaseButton>) {
  return <BaseButton {...props} size={size} data-control-size={size} />;
}

/** Native semantics preserve optgroups, keyboard navigation and mobile pickers. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cn('workbench-select', className)} />;
}

export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn('workbench-checkbox', className)}
    />
  );
}
