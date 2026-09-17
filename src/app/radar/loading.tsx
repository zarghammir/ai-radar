import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the route segment loads. The shapes match what replaces them so
 * the page does not jump when the content arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 pl-10 lg:px-10 lg:py-10 lg:pl-16">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-52" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <span className="sr-only">Loading Live Radar</span>
    </div>
  );
}
