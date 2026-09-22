import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../components/ui/sheet';

export function AccountDrawer({
  trigger,
  children,
  description,
}: {
  trigger: ReactElement;
  children: ReactNode;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetTitle>Account</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
