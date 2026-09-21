import type { ComponentProps } from 'react';
import { DialogContent } from './dialog';

export {
  Dialog as Sheet,
  DialogTrigger as SheetTrigger,
  DialogClose as SheetClose,
  DialogTitle as SheetTitle,
  DialogDescription as SheetDescription,
} from './dialog';

export function SheetContent(
  props: Omit<ComponentProps<typeof DialogContent>, 'presentation'>,
) {
  return <DialogContent {...props} presentation="sheet" />;
}
