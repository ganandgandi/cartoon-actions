// PILOT DIAGNOSTIC entry: trivial composition (no three.js) to isolate whether
// renderMedia itself works on this VM, vs. the Bridge scene being the bottleneck.
import React from "react";
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "remotion";

const Tiny: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: f % 2 ? "#2244aa" : "#aa4422", justifyContent: "center", alignItems: "center" }}>
      <div style={{ color: "white", fontSize: 120, fontFamily: "sans-serif" }}>{f}</div>
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition id="TinyComp" component={Tiny} durationInFrames={60} fps={30} width={1080} height={1920} />
);
registerRoot(Root);
