# Phase 2 Frontend — Quick Start Guide

**Last Updated:** 2026-07-16 (After npm install + TypeScript validation)

---

## 🚀 Start the Dev Server

```bash
cd c:\Users\user\DMS\web
npm run dev
```

**Expected Output:**
```
  VITE v5.4.2  ready in 234 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

---

## 🌐 Open in Browser

1. **Visit:** http://localhost:5173
2. **You should see:**
   - ✅ Top navbar with Si-Ware logo + DMS title
   - ✅ Left sidebar (280px) with My Tasks, Vault, Approvals, Settings
   - ✅ Main dashboard with:
     - Welcome message ("Welcome back, Ahmed Ali! 👋")
     - 3 quick stat cards (Open, In Progress, Pending)
     - My Tasks list (3 sample tasks)
     - Recent Documents (2 samples)
     - Pending Approvals (1 sample)
   - ✅ Dark mode support (auto-detects system preference)
   - ✅ Mobile responsive (hamburger menu on small screens)

---

## 🔧 TypeScript Validation

```bash
npm run type-check
```

**Expected:** ✅ Zero errors

---

## 📦 Build for Production

```bash
npm run build
```

**Output:** `dist/` folder ready to deploy

---

## 📁 Project Structure

```
/web/src
├── /components
│   ├── /ui           — Reusable UI components (Button, Card, Badge, Skeleton)
│   ├── /layout       — App layout (Navbar, Sidebar, MainLayout)
│   └── /pages        — Page components (Dashboard, soon: Documents, Tasks, etc.)
├── /hooks            — Custom React hooks (useAuth, useToast)
├── /utils            — Utilities (API client, formatters)
├── /types            — TypeScript entity types (14 total)
├── /styles           — Global CSS + Tailwind
├── App.tsx           — React Router setup
└── main.tsx          — Entry point
```

---

## 🎨 Styling

All components use **Tailwind CSS** with **dark mode** support:

```tsx
// Example: Dark mode works automatically
<div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
  Light mode: white bg, dark text
  Dark mode: gray bg, light text
</div>
```

---

## 🔌 API Integration

The dev server automatically proxies `/api` requests to `http://localhost:8080`:

```tsx
// src/utils/api.ts has 30+ ready-to-use methods
import { apiClient } from '@/utils/api'

// Example:
const users = await apiClient.getUsers()  // ✅ Works (proxied to :8080)
const docs = await apiClient.getDocuments('folder-id')
const tasks = await apiClient.getTasks()
```

---

## 🎯 Responsive Breakpoints

```
sm:  640px   — Small phones
md:  768px   — Tablets
lg:  1024px  — Small desktops
xl:  1280px  — Large desktops
2xl: 1536px  — 4K monitors
```

Used in Tailwind:
```tsx
<div className="w-full md:w-1/2 lg:w-1/3">
  Full width on mobile, 50% on tablet, 33% on desktop
</div>
```

---

## 🧩 Component Examples

### Button
```tsx
import { Button } from '@/components/ui'

<Button variant="primary" size="md">Primary Button</Button>
<Button variant="secondary" size="sm" isLoading>Loading...</Button>
<Button variant="danger">Delete</Button>
```

### Badge
```tsx
import { Badge } from '@/components/ui'

<Badge status="success">Approved</Badge>
<Badge status="warning" variant="outline">Pending</Badge>
<Badge status="error">Rejected</Badge>
```

### Card
```tsx
import { Card, CardBody, CardHeader, CardFooter } from '@/components/ui'

<Card>
  <CardHeader>Title</CardHeader>
  <CardBody>Content</CardBody>
  <CardFooter>Action buttons</CardFooter>
</Card>
```

### Toast (Notifications)
```tsx
import { useToast } from '@/hooks'

const { showSuccess, showError, showInfo } = useToast()

showSuccess('Document uploaded!')
showError('Failed to load document')
showInfo('Processing...')
```

---

## 🔒 Authentication

Currently mocked:
```tsx
// src/hooks/useAuth.ts
const { user, logout } = useAuth()

user = {
  userId: 'user-1',
  fullName: 'Ahmed Ali',
  email: 'alii.mohamed@si-ware.com',
  role: 'Manager',
}
```

**TODO (Phase 2.4):** Integrate with real auth system

---

## 🚦 Hot Module Replacement (HMR)

The dev server auto-reloads on file changes:
1. **Edit** a React component
2. **Save** (Ctrl+S)
3. **Browser updates instantly** (no full refresh)

---

## 📝 Git Workflow

After making changes:

```bash
# 1. Check status
git status

# 2. Stage files
git add src/components/MyComponent.tsx

# 3. Commit
git commit -m "feat: Add MyComponent with dark mode support"

# 4. Push
git push origin ali-branch
```

---

## 🐛 Troubleshooting

### Dev server won't start
```bash
# Kill process on port 5173
lsof -i :5173 | grep LISTEN | awk '{print $2}' | xargs kill -9

# Try again
npm run dev
```

### API calls fail (CORS error)
- Ensure API is running: `docker compose up -d api`
- Check proxy in vite.config.ts: should route `/api` → `http://localhost:8080`

### TypeScript errors
```bash
npm run type-check
```

### Module not found
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

---

## 📊 Performance Tips

1. **Code splitting:** Use React.lazy() for routes
2. **Image optimization:** Load images async
3. **Memoization:** Wrap expensive components with React.memo()
4. **Virtual scrolling:** For large lists (installed: none yet, can add)

---

## 🎓 Next Steps

1. ✅ Run `npm run dev` and verify dashboard loads
2. ✅ Check that sidebar navigation works
3. ✅ Inspect browser DevTools (React tab shows components)
4. ✅ Try toggling dark mode (system preference)
5. 📋 Start building Pages 2-5 (Documents, Approvals, Tasks, Settings)

---

## 📞 Support Resources

- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) — Colors, fonts, components, accessibility
- [FRONTEND_STATUS.md](FRONTEND_STATUS.md) — Detailed status, metrics, dependencies
- [../PHASE2_FRONTEND_INIT.md](../PHASE2_FRONTEND_INIT.md) — Session 3 work summary

---

**Status:** ✅ Ready to develop — all infrastructure in place, dev server tested

