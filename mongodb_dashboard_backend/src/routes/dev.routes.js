const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const AppDeployment = require('../models/appDeployments.model');
const User = require('../models/user.model');
const Sample = require('../models/sample.model');
const Tenant = require('../models/tenant.model');
const Project = require('../models/project.model');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/db-status
 * Returns basic status about the MongoDB connection for debugging:
 * - connected: boolean
 * - dbName: string
 * - host: string (cluster host)
 * - mongooseState: number (connection.readyState)
 */
router.get('/db-status', asyncHandler(async (req, res) => {
  const conn = mongoose.connection;
  let host = 'unknown-host';
  try {
    const uri = process.env.MONGODB_URI ||
      'mongodb+srv://govindarajmalaiarasu_db_user:MGRaj2005@phaseonedata.qlyhyxu.mongodb.net/?retryWrites=true&w=majority&appName=PhaseOneData';
    const parsed = new URL(uri);
    host = parsed.hostname || host;
  } catch {
    // ignore
  }
  return res.status(200).json({
    success: true,
    connected: conn.readyState === 1,
    dbName: conn?.name,
    host,
    mongooseState: conn.readyState,
  });
}));

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/seed
 * Seeds sample records into users, sample, session_tracking and app_deployments if collections are empty.
 * This helps verify that the list endpoints return non-empty results.
 * 
 * Returns envelope with before/after/inserted counts and one sample document per collection.
 */
router.get('/seed', asyncHandler(async (req, res) => {
  const countsBefore = await Promise.all([
    User.countDocuments({}),
    Sample.countDocuments({}),
    SessionTracking.countDocuments({}),
    AppDeployment.countDocuments({}),
    Tenant.countDocuments({}),
    Project.countDocuments({}),
  ]);
  const [usersBefore, sampleBefore, sessionBefore, appBefore, tenantsBefore, projectsBefore] = countsBefore;

  let usersInserted = 0;
  let sampleInserted = 0;
  let sessionInserted = 0;
  let appInserted = 0;
  let tenantsInserted = 0;
  let projectsInserted = 0;

  // Seed users if empty
  if (usersBefore === 0) {
    const now = new Date();
    const users = [
      {
        referral_code: 'REF-ALPHA',
        referral_stats: { total_referrals: 3, verified_referrals: 2, last_referral_date: now },
        referral_history: [
          { user_id: 'u-201', user_email: 'a@example.com', user_name: 'User A', referred_at: now, status: 'verified' },
          { user_id: 'u-202', user_email: 'b@example.com', user_name: 'User B', referred_at: now, status: 'pending' },
        ],
        created_at: now,
        updated_at: now,
      },
      {
        referral_code: 'REF-BETA',
        referral_stats: [
          { total_referrals: 1, verified_referrals: 1, last_referral_date: now },
        ],
        referral_history: [],
        created_at: now,
        updated_at: now,
      },
    ];
    const resUsers = await User.insertMany(users);
    usersInserted = resUsers.length;
  }

  // Seed sample if empty
  if (sampleBefore === 0) {
    const now = new Date();
    const docs = [
      { name: 'demo', value: { any: 'shape', ok: true }, created_at: now },
      { name: 'alpha', value: 42, created_at: new Date(now.getTime() - 60000) },
    ];
    const resSample = await Sample.insertMany(docs);
    sampleInserted = resSample.length;
  }

  // Seed tenants if empty
  if (tenantsBefore === 0) {
    const now = new Date();
    const tenants = [
      {
        tenant_id: 'org-1',
        tenant_name: 'Org One',
        description: 'Demo tenant one',
        allocated_credits: 100,
        credits_unit: 'USD',
        groups: ['Engineering', 'QA'],
        users: [
          { user_id: 'user-123', role: 'admin', groups: ['Engineering'] },
          { user_id: 'user-789', role: 'member', groups: ['QA'] },
        ],
        projects: ['proj-001', 'proj-003'],
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        tenant_id: 'org-2',
        tenant_name: 'Org Two',
        description: 'Demo tenant two',
        allocated_credits: 250,
        credits_unit: 'USD',
        groups: ['Platform'],
        users: [{ user_id: 'user-456', role: 'owner', groups: ['Platform'] }],
        projects: ['proj-002'],
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ];
    const resTenants = await Tenant.insertMany(tenants);
    tenantsInserted = resTenants.length;
  }

  // Seed projects if empty
  if (projectsBefore === 0) {
    const now = new Date();
    const projects = [
      {
        tenant_id: 'org-1',
        project_id: 'proj-001',
        project_name: 'Project One',
        description: 'Demo project 1',
        owner_user_id: 'user-123',
        access_users: [
          { user_id: 'user-123', role: 'owner', access_level: 'admin' },
          { user_id: 'user-789', role: 'member', access_level: 'read' },
        ],
        allocated_credits: 60,
        credits_unit: 'USD',
        status: 'active',
        created_at: now,
        updated_at: now,
        tags: ['demo', 'web'],
      },
      {
        tenant_id: 'org-2',
        project_id: 'proj-002',
        project_name: 'Project Two',
        description: 'Demo project 2',
        owner_user_id: 'user-456',
        access_users: [{ user_id: 'user-456', role: 'owner', access_level: 'admin' }],
        allocated_credits: 150,
        credits_unit: 'USD',
        status: 'active',
        created_at: now,
        updated_at: now,
        tags: ['maintenance'],
      },
      {
        tenant_id: 'org-1',
        project_id: 'proj-003',
        project_name: 'Project Three',
        description: 'Demo project 3',
        owner_user_id: 'user-789',
        access_users: [{ user_id: 'user-789', role: 'owner', access_level: 'admin' }],
        allocated_credits: 40,
        credits_unit: 'USD',
        status: 'active',
        created_at: now,
        updated_at: now,
        tags: ['experimental'],
      },
    ];
    const resProjects = await Project.insertMany(projects);
    projectsInserted = resProjects.length;
  }

  // Seed session_tracking if empty
  if (sessionBefore === 0) {
    const now = new Date();
    const docs = [
      {
        task_id: 'task-001',
        tenant_id: 'org-1',
        organization_name: 'Org One',
        user_id: 'user-123',
        user_name: 'Alice',
        project_id: 'proj-001',
        container_id: 'code-gen',
        service_type: 'code generation',
        session_start: new Date(now.getTime() - 60 * 60 * 1000),
        session_end: null,
        status: 'active',
        total_cost: 1.23,
        agent_costs: { planner: 0.5, coder: 0.73 },
        cost_history: [
          { timestamp: new Date(now.getTime() - 50 * 60 * 1000), total_cost: 0.5, agent_costs: { planner: 0.5 } },
          { timestamp: new Date(now.getTime() - 10 * 60 * 1000), total_cost: 0.73, agent_costs: { coder: 0.73 } },
        ],
        last_updated: now,
        session_data: {
          llm_model: 'gpt-4o',
          session_name: 'Initial Build',
          description: 'Seeding session',
          platform: 'web',
          selected_repos: { all_repositories: true, repositories: [] },
        },
        created_at: now,
      },
      {
        task_id: 'task-002',
        tenant_id: 'org-2',
        organization_name: 'Org Two',
        user_id: 'user-456',
        user_name: 'Bob',
        project_id: 'proj-002',
        container_id: 'code-maint',
        service_type: 'code maintenance',
        session_start: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        session_end: new Date(now.getTime() - 30 * 60 * 1000),
        status: 'completed',
        total_cost: 3.5,
        agent_costs: { fixer: 3.5 },
        cost_history: [
          { timestamp: new Date(now.getTime() - 100 * 60 * 1000), total_cost: 1.5, agent_costs: { fixer: 1.5 } },
          { timestamp: new Date(now.getTime() - 30 * 60 * 1000), total_cost: 2.0, agent_costs: { fixer: 2.0 } },
        ],
        last_updated: now,
        session_data: {
          llm_model: 'gpt-4o',
          session_name: 'Bug Bash',
          description: 'Maintenance session',
          platform: 'web',
          selected_repos: { all_repositories: false, repositories: ['repo-1'] },
        },
        created_at: now,
      },
    ];
    const result = await SessionTracking.insertMany(docs);
    sessionInserted = result.length;
  }

  // Seed app_deployments if empty
  if (appBefore === 0) {
    const now = new Date();
    const docs = [
      {
        app_id: 'app-001',
        app_url: 'https://example-app-001.example.com',
        artifact_path: '/builds/app-001',
        branch_name: 'main',
        build_path: '/builds/app-001/build',
        command: 'npm run build',
        created_at: now,
        custom_domain: null,
        deployment_id: 'deploy-001',
        job_id: 'job-001',
        message: 'Initial deployment',
        project_id: 'proj-001',
        project_name: 'Project One',
        root_path: '/var/www/app-001',
        status: 'success',
        subdomain: 'app-001',
        task_id: 'task-001',
        tenant_id: 'org-1',
        tenant_name: 'Org One',
        updated_at: now,
        artifact_count: 12,
        domain_status: 'verified',
        domain_checked_at: now,
      },
      {
        app_id: 'app-002',
        app_url: 'https://example-app-002.example.com',
        artifact_path: '/builds/app-002',
        branch_name: 'develop',
        build_path: '/builds/app-002/build',
        command: 'npm run build',
        created_at: now,
        custom_domain: 'app-002.example.com',
        deployment_id: 'deploy-002',
        job_id: 'job-002',
        message: 'Dev deployment',
        project_id: 'proj-002',
        project_name: 'Project Two',
        root_path: '/var/www/app-002',
        status: 'in-progress',
        subdomain: 'app-002',
        task_id: 'task-002',
        tenant_id: 'org-2',
        tenant_name: 'Org Two',
        updated_at: now,
        artifact_count: 5,
        domain_status: 'pending',
        domain_checked_at: null,
      },
    ];
    const result = await AppDeployment.insertMany(docs);
    appInserted = result.length;
  }

  const [usersAfter, sampleAfter, sessionAfter, appAfter, tenantsAfter, projectsAfter] = await Promise.all([
    User.countDocuments({}),
    Sample.countDocuments({}),
    SessionTracking.countDocuments({}),
    AppDeployment.countDocuments({}),
    Tenant.countDocuments({}),
    Project.countDocuments({}),
  ]);

  const samples = await Promise.all([
    User.findOne({}).sort({ _id: -1 }).lean(),
    Sample.findOne({}).sort({ _id: -1 }).lean(),
    SessionTracking.findOne({}).sort({ _id: -1 }).lean(),
    AppDeployment.findOne({}).sort({ _id: -1 }).lean(),
    Tenant.findOne({}).sort({ _id: -1 }).lean(),
    Project.findOne({}).sort({ _id: -1 }).lean(),
  ]);

  return res.status(200).json({
    success: true,
    users: { before: usersBefore, inserted: usersInserted, after: usersAfter, sample: samples[0] || null },
    sample: { before: sampleBefore, inserted: sampleInserted, after: sampleAfter, sample: samples[1] || null },
    sessionTracking: { before: sessionBefore, inserted: sessionInserted, after: sessionAfter, sample: samples[2] || null },
    appDeployments: { before: appBefore, inserted: appInserted, after: appAfter, sample: samples[3] || null },
    tenants: { before: tenantsBefore, inserted: tenantsInserted, after: tenantsAfter, sample: samples[4] || null },
    projects: { before: projectsBefore, inserted: projectsInserted, after: projectsAfter, sample: samples[5] || null },
  });
}));

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/verify
 * Quickly verify data availability and basic querying across all collections.
 * Returns counts and the first 3 documents for each collection.
 */
router.get('/verify', asyncHandler(async (req, res) => {
  const [users, sample, sessions, apps, tenants, projects] = await Promise.all([
    User.find({}).limit(3).lean(),
    Sample.find({}).limit(3).lean(),
    SessionTracking.find({}).limit(3).lean(),
    AppDeployment.find({}).limit(3).lean(),
    Tenant.find({}).limit(3).lean(),
    Project.find({}).limit(3).lean(),
  ]);
  const [usersCount, sampleCount, sessionsCount, appsCount, tenantsCount, projectsCount] = await Promise.all([
    User.countDocuments({}),
    Sample.countDocuments({}),
    SessionTracking.countDocuments({}),
    AppDeployment.countDocuments({}),
    Tenant.countDocuments({}),
    Project.countDocuments({}),
  ]);

  return res.status(200).json({
    success: true,
    users: { count: usersCount, data: users },
    sample: { count: sampleCount, data: sample },
    sessionTracking: { count: sessionsCount, data: sessions },
    appDeployments: { count: appsCount, data: apps },
    tenants: { count: tenantsCount, data: tenants },
    projects: { count: projectsCount, data: projects },
  });
}));

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/seed-llm-costs
 * Seeds demo LLM cost records if the llm_costs collection is empty.
 * Generates small daily costs across multiple models for the past 90 days.
 * This endpoint is intended for preview/dev only and does not enforce auth.
 */
router.get('/seed-llm-costs', asyncHandler(async (req, res) => {
  const before = await LLMCost.countDocuments({});
  let inserted = 0;

  if (before === 0) {
    const models = ['gpt-4o', 'claude-3', 'gpt-4o-mini'];
    const now = new Date();
    const days = 90;
    const docs = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0));
      d.setUTCDate(d.getUTCDate() - i);
      for (const m of models) {
        // small random value between 0.0005 and 0.02
        const amount = 0.0005 + Math.random() * 0.0195;
        docs.push({
          llm_model: m,
          total_cost: Number(amount.toFixed(5)),
          currency: 'USD',
          provider: m.includes('claude') ? 'anthropic' : 'openai',
          operation: 'chat.completions',
          tenant_id: i % 2 === 0 ? 'org-1' : 'org-2',
          project_id: i % 3 === 0 ? 'proj-001' : i % 3 === 1 ? 'proj-002' : 'proj-003',
          user_id: i % 2 === 0 ? 'user-123' : 'user-456',
          timestamp: d,
          created_at: d,
          updated_at: d,
          metadata: { seed: true },
        });
      }
    }
    const result = await LLMCost.insertMany(docs);
    inserted = result.length;
  }

  const after = await LLMCost.countDocuments({});
  const sample = await LLMCost.findOne({}).sort({ _id: -1 }).lean();

  return res.status(200).json({
    success: true,
    before,
    inserted,
    after,
    sample: sample || null,
  });
}));

module.exports = router;
