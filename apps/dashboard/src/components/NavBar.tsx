"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getPractices } from "../lib/api";

export function NavBar() {
  const path = usePathname();
  const isReview = path?.startsWith("/review");
  const isQueue = !isReview;
  const [practice, setPractice] = useState("Cedar Park Dental Studio");

  useEffect(() => {
    let live = true;
    getPractices()
      .then((ps) => {
        if (live && ps[0]) setPractice(ps[0].name);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <header className="appbar">
      <div className="appbar-inner">
        <div className="brand">
          NightShift
          <small>{practice}</small>
        </div>
        <nav className="nav">
          <Link href="/" className={isQueue ? "active" : ""}>
            Morning queue
          </Link>
          <Link href="/review" className={isReview ? "active" : ""}>
            Review queue
          </Link>
        </nav>
      </div>
    </header>
  );
}
