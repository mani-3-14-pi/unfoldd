import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { RouteError } from '@/components/RouteError'
import { AdminLayout } from '@/layouts/AdminLayout'
import { AgencyLayout } from '@/layouts/AgencyLayout'
import { AdminLoginPage } from '@/pages/admin/AdminLoginPage'
import { AgencyLoginPage } from '@/pages/agency/AgencyLoginPage'
import { AgencySignupPage } from '@/pages/agency/AgencySignupPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/**
 * A route whose page is loaded only when it's first opened, so signing in doesn't download the whole portal.
 * The layouts and sign-in pages stay in the main bundle.
 */
const page = (path: string | undefined, load: () => Promise<ComponentType>): RouteObject => ({
  ...(path === undefined ? { index: true } : { path }),
  lazy: async () => ({ Component: await load() }),
})

export const router = createBrowserRouter([
  // One error screen for every page, instead of React Router's developer screen.
  {
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/login" replace /> },

      // Sign-in for agency and client people (one login), and the public invite link
      { path: 'login', element: <AgencyLoginPage /> },
      { path: 'signup', element: <AgencySignupPage /> },
      page('invite/:token', () => import('@/pages/InvitePage').then((m) => m.InvitePage)),

      // Agency portal (tenants)
      {
        path: 'app',
        element: <AgencyLayout />,
        children: [
          page(undefined, () => import('@/pages/agency/DashboardPage').then((m) => m.DashboardPage)),
          page('clients', () => import('@/pages/agency/ClientsPage').then((m) => m.ClientsPage)),
          // `threadId` opens one conversation: /app/clients/:id/conversations/:threadId
          page('clients/:id/:tab?/:threadId?', () => import('@/pages/agency/ClientDetailPage').then((m) => m.ClientDetailPage)),
          page('content', () => import('@/pages/agency/ContentPage').then((m) => m.ContentPage)),
          page('content/:id', () => import('@/pages/agency/ContentDetailPage').then((m) => m.ContentDetailPage)),
          page('review', () => import('@/pages/agency/ReviewQueuePage').then((m) => m.ReviewQueuePage)),
          page('feedback', () => import('@/pages/agency/FeedbackInboxPage').then((m) => m.FeedbackInboxPage)),
          page('tasks', () => import('@/pages/agency/TasksPage').then((m) => m.TasksPage)),
          page('tasks/:id', () => import('@/pages/agency/TaskDetailPage').then((m) => m.TaskDetailPage)),
          page('calendar', () => import('@/pages/agency/CalendarPage').then((m) => m.CalendarPage)),
          page('campaigns', () => import('@/pages/agency/CampaignsPage').then((m) => m.CampaignsPage)),
          page('campaigns/:id', () => import('@/pages/agency/CampaignDetailPage').then((m) => m.CampaignDetailPage)),
          page('plans', () => import('@/pages/agency/PlansPage').then((m) => m.PlansPage)),
          page('plans/:id', () => import('@/pages/agency/PlanDetailPage').then((m) => m.PlanDetailPage)),
          page('requests', () => import('@/pages/agency/RequestsPage').then((m) => m.RequestsPage)),
          page('requests/:id', () => import('@/pages/agency/RequestDetailPage').then((m) => m.RequestDetailPage)),
          page('meetings', () => import('@/pages/agency/MeetingsPage').then((m) => m.MeetingsPage)),
          page('meetings/:id', () => import('@/pages/agency/MeetingDetailPage').then((m) => m.MeetingDetailPage)),
          page('analytics', () => import('@/pages/agency/AnalyticsPage').then((m) => m.AnalyticsPage)),
          page('reports', () => import('@/pages/agency/ReportsPage').then((m) => m.ReportsPage)),
          page('reports/:id', () => import('@/pages/agency/ReportDetailPage').then((m) => m.ReportDetailPage)),
          // The platforms send the browser back here after connecting an account (backend integrations.routes.ts).
          page('integrations/callback', () => import('@/pages/agency/IntegrationsCallbackPage').then((m) => m.IntegrationsCallbackPage)),
          page('team/:tab?', () => import('@/pages/agency/TeamPage').then((m) => m.TeamPage)),
          page('notifications', () => import('@/pages/agency/NotificationsPage').then((m) => m.NotificationsPage)),
          page('activity', () => import('@/pages/agency/ActivityPage').then((m) => m.ActivityPage)),
          page('banners', () => import('@/pages/agency/BannersPage').then((m) => m.BannersPage)),
          page('templates', () => import('@/pages/agency/TemplatesPage').then((m) => m.TemplatesPage)),
          page('settings', () => import('@/pages/agency/SettingsPage').then((m) => m.SettingsPage)),
          page('account', () => import('@/pages/agency/AccountPage').then((m) => m.AccountPage)),
          page('support', () => import('@/pages/agency/SupportPage').then((m) => m.SupportPage)),
          { path: '*', element: <NotFoundPage /> },
        ],
      },

      // Client app: a holding page until it's built
      page('c/*', () => import('@/pages/client/ClientPlaceholderPage').then((m) => m.ClientPlaceholderPage)),

      // Platform admin (super admin)
      { path: 'admin/login', element: <AdminLoginPage /> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          page(undefined, () => import('@/pages/admin/OverviewPage').then((m) => m.OverviewPage)),
          page('agencies', () => import('@/pages/admin/AgenciesPage').then((m) => m.AgenciesPage)),
          page('agencies/:id/:tab?', () => import('@/pages/admin/AgencyDetailPage').then((m) => m.AgencyDetailPage)),
          page('approvals', () => import('@/pages/admin/ApprovalsPage').then((m) => m.ApprovalsPage)),
          page('subscriptions', () => import('@/pages/admin/SubscriptionsPage').then((m) => m.SubscriptionsPage)),
          page('activity', () => import('@/pages/admin/ActivityPage').then((m) => m.ActivityPage)),
          page('settings', () => import('@/pages/admin/SettingsPage').then((m) => m.SettingsPage)),
          { path: '*', element: <NotFoundPage /> },
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
