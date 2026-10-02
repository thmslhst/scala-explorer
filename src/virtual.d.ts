/// <reference types="vite/client" />

declare module 'virtual:scale-index' {
  import type { ScaleEntry } from '@/lib/scala/entry';
  const index: ScaleEntry[];
  export default index;
}
