"use client";

import dynamic from "next/dynamic";

const Viewer = dynamic(() => import("./viewer"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center bg-[#0e1210] text-[#f4f1ea]">球場を準備しています</div>
  ),
});

export default function ViewerDynamic() {
  return <Viewer />;
}
