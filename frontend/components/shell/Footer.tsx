import { ModelChip } from "./ModelChip";

export function Footer() {
  return (
    <footer className="foot">
      <span className="nv">Powered by NVIDIA Nemotron</span>
      <ModelChip tier="ultra" job="analyst" />
      <ModelChip tier="super" job="news & setup reader" />
      <ModelChip tier="fast" job="shoppers" />
      <span className="sp" />
      <span className="muted">Runs on Nebius · news by Tavily</span>
    </footer>
  );
}
