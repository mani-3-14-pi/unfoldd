import { Router } from 'express'
import { requireAgencyUser, requireClientUser, requirePlatformAdmin, requireUser } from './middleware/auth.ts'
import { activityAdminRouter } from './modules/activity/activity.admin.routes.ts'
import { overviewRouter } from './modules/admin/overview.routes.ts'
import { agencyRouter } from './modules/agencies/agency.routes.ts'
import { agenciesAdminRouter } from './modules/agencies/agencies.admin.routes.ts'
import { subscriptionsAdminRouter } from './modules/agencies/subscriptions.admin.routes.ts'
import { adminAuthRouter } from './modules/auth/adminAuth.routes.ts'
import { agencyAuthRouter } from './modules/auth/agencyAuth.routes.ts'
import { analyticsRouter, clientAnalyticsRouter, reportsRouter } from './modules/analytics/analytics.routes.ts'
import { bannersRouter, clientBannersRouter } from './modules/banners/banners.routes.ts'
import { integrationsRouter } from './modules/publishing/integrations.routes.ts'
import { supportAdminRouter, supportRouter } from './modules/support/support.routes.ts'
import { accountRouter } from './modules/users/account.routes.ts'
import { brandRouter, clientBrandRouter } from './modules/brand/brand.routes.ts'
import { clientConversationsRouter, conversationsRouter } from './modules/feedback/conversations.routes.ts'
import { clientLibraryRouter, libraryRouter } from './modules/files/library.routes.ts'
import { clientMeetingsRouter, meetingsRouter } from './modules/meetings/meetings.routes.ts'
import { campaignsRouter, clientCampaignsRouter } from './modules/campaigns/campaigns.routes.ts'
import { checklistRouter } from './modules/checklist/checklist.routes.ts'
import { calendarRouter, clientCalendarRouter, clientHomeRouter, dashboardRouter } from './modules/dashboard/dashboard.routes.ts'
import { clientPlansRouter, plansRouter } from './modules/plans/plans.routes.ts'
import { clientRequestsRouter, requestsRouter } from './modules/requests/requests.routes.ts'
import { templatesRouter } from './modules/templates/templates.routes.ts'
import { clientsRouter } from './modules/clients/clients.routes.ts'
import { clientContentRouter } from './modules/content/clientContent.routes.ts'
import { contentRouter } from './modules/content/content.routes.ts'
import { feedbackInboxRouter, feedbackRouter } from './modules/feedback/feedback.routes.ts'
import { clientSpaceRouter } from './modules/clients/clientSpace.routes.ts'
import { filesRouter } from './modules/files/files.routes.ts'
import { healthRouter } from './modules/health/health.routes.ts'
import { invitationsPublicRouter } from './modules/invitations/invitations.public.routes.ts'
import { notificationsRouter } from './modules/notifications/notifications.routes.ts'
import { searchRouter } from './modules/search/search.routes.ts'
import { settingsAdminRouter } from './modules/settings/settings.admin.routes.ts'
import { tasksRouter } from './modules/tasks/tasks.routes.ts'
import { teamRouter } from './modules/team/team.routes.ts'

/** Every feature module mounts its router here, under /api. */
export const apiRouter = Router()

apiRouter.use('/health', healthRouter)

// Sign-in for agency and client people (one login, D43), and the public invite link.
apiRouter.use('/auth', agencyAuthRouter)
apiRouter.use('/invitations', invitationsPublicRouter)

// Agency portal (tenants)
apiRouter.use('/agency', requireAgencyUser, agencyRouter, teamRouter)
apiRouter.use('/clients', requireAgencyUser, clientsRouter, brandRouter, libraryRouter, conversationsRouter)
apiRouter.use('/meetings', requireAgencyUser, meetingsRouter)
apiRouter.use('/integrations', integrationsRouter)
apiRouter.use('/analytics', requireAgencyUser, analyticsRouter)
apiRouter.use('/reports', requireAgencyUser, reportsRouter)
apiRouter.use('/content', requireAgencyUser, contentRouter, feedbackRouter, checklistRouter)
apiRouter.use('/tasks', requireAgencyUser, tasksRouter)
apiRouter.use('/campaigns', requireAgencyUser, campaignsRouter)
apiRouter.use('/plans', requireAgencyUser, plansRouter)
apiRouter.use('/requests', requireAgencyUser, requestsRouter)
apiRouter.use('/templates', requireAgencyUser, templatesRouter)
apiRouter.use('/banners', requireAgencyUser, bannersRouter)
apiRouter.use('/dashboard', requireAgencyUser, dashboardRouter)
apiRouter.use('/calendar', requireAgencyUser, calendarRouter)
apiRouter.use('/feedback', requireAgencyUser, feedbackInboxRouter)

// Client App: one client space at a time
apiRouter.use('/client/home', requireClientUser, clientHomeRouter)
apiRouter.use('/client/content', requireClientUser, clientContentRouter)
apiRouter.use('/client/plans', requireClientUser, clientPlansRouter)
apiRouter.use('/client/requests', requireClientUser, clientRequestsRouter)
apiRouter.use('/client/campaigns', requireClientUser, clientCampaignsRouter)
apiRouter.use('/client/calendar', requireClientUser, clientCalendarRouter)
apiRouter.use('/client/banners', requireClientUser, clientBannersRouter)
apiRouter.use('/client/brand', requireClientUser, clientBrandRouter)
apiRouter.use('/client/meetings', requireClientUser, clientMeetingsRouter)
apiRouter.use('/client/library', requireClientUser, clientLibraryRouter)
apiRouter.use('/client/conversations', requireClientUser, clientConversationsRouter)
apiRouter.use('/client/analytics', requireClientUser, clientAnalyticsRouter)
apiRouter.use('/client', requireClientUser, clientSpaceRouter)

// Shared by both apps; scoped to whichever one the session is in
apiRouter.use('/files', requireUser, filesRouter)
apiRouter.use('/search', requireUser, searchRouter)
apiRouter.use('/notifications', requireUser, notificationsRouter)
apiRouter.use('/me', requireUser, accountRouter)
apiRouter.use('/support', requireUser, supportRouter)

// Platform admin (super admin). Everything except login needs a platform session.
apiRouter.use('/admin/auth', adminAuthRouter)
const admin = Router()
admin.use(requirePlatformAdmin)
admin.use('/overview', overviewRouter)
admin.use('/agencies', agenciesAdminRouter)
admin.use('/subscriptions', subscriptionsAdminRouter)
admin.use('/activity', activityAdminRouter)
admin.use('/settings', settingsAdminRouter)
admin.use('/support', supportAdminRouter)
apiRouter.use('/admin', admin)
