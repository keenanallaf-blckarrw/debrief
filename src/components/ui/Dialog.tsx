import * as RDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

// Modal (centered) and Drawer (slides in from the right) built on Radix, which
// handles focus, Escape to close and screen-reader labels.

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = "max-w-[640px]",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px] animate-fade-in" />
        <RDialog.Content
          className={`fixed left-1/2 top-[6vh] z-50 max-h-[88vh] w-[calc(100vw-24px)] ${width} -translate-x-1/2 overflow-y-auto rounded-[22px] border border-line bg-card shadow-2xl outline-none animate-fade-in`}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line-2 bg-card/95 px-6 py-4 backdrop-blur">
            <div>
              <RDialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-0.5 text-[13px] text-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">Dialog</RDialog.Description>
              )}
            </div>
            <RDialog.Close className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-soft hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </RDialog.Close>
          </div>
          <div className="px-6 py-5">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  headerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/60 animate-fade-in" />
        <RDialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[880px] flex-col border-l border-line bg-panel shadow-2xl outline-none animate-fade-in">
          <div className="flex items-start justify-between gap-4 border-b border-line-2 px-6 py-4">
            <div className="min-w-0">
              <RDialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-0.5 text-[13px] text-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">Details</RDialog.Description>
              )}
            </div>
            <div className="flex items-center gap-2">
              {headerExtra}
              <RDialog.Close className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-soft hover:text-ink" aria-label="Close">
                <X className="size-4" />
              </RDialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
