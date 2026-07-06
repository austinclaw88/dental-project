// Minimal stand-ins for next/navigation hooks used in unit tests.
export function usePathname(): string {
  return "/";
}
export function useRouter() {
  return { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} };
}
export function useSearchParams() {
  return new URLSearchParams();
}
