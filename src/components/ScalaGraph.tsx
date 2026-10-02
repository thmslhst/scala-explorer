import { renderGraphSvg } from '@/lib/scala/svg';
import type { Graph, Reveal } from '@/lib/scala/graph';

// Thin wrapper over svg.ts. The reveal is CSS inside the markup, so mounting
// plays it; give this a new key to replay.
export default function ScalaGraph({ graph, reveal, className }: { graph: Graph; reveal?: Reveal; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderGraphSvg(graph, reveal) }} />;
}
