import styles from "./RouteSkeleton.module.css";

// Keep the fallback server-renderable while destination JavaScript is delayed.
// The root layout's existing locale initializer selects the visible language.
export default function RouteLoadingStatus() {
  return <span className={styles.status} role="status">
    <span lang="en">Loading…</span>
    <span lang="zh-CN">加载中…</span>
  </span>;
}
