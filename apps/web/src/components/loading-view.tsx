import { Spinner } from "./ui/spinner.tsx";

/** What stands in a view's place while the code that draws it is loaded. */
export function LoadingView() {
  return (
    <div className="flex h-full min-h-16 items-center justify-center">
      <Spinner />
    </div>
  );
}
