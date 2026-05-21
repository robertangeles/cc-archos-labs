import { BlogSubNav } from "./blog-sub-nav";

// Tabbed shell for everything under /admin/blog. Adds a horizontal
// sub-nav (Settings | Posts) above the page content so the blog admin
// has a natural two-tab home. Top-level admin chrome (sidebar tabs,
// sign-out, "Admin" eyebrow) is provided by the (authed) layout one
// level up.
//
// Sub-tabs:
//   - /admin/blog          → Settings (the public-/blog feature toggle)
//   - /admin/blog/posts/*  → Posts (CRUD + scheduling + AI assist)

export default function AdminBlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <BlogSubNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
