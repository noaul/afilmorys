import { authUsers, photoAssets, tenantDomains } from '@afilmory/db'
import { DbAccessor } from '@core/database/database.provider'
import { Roles } from '@core/guards/roles.decorator'
import { BypassResponseTransform } from '@core/interceptors/response-transform.decorator'
import { SystemSettingService } from '@core/modules/configuration/system-setting/system-setting.service'
import { BillingPlanService } from '@core/modules/platform/billing/billing-plan.service'
import { BillingUsageService } from '@core/modules/platform/billing/billing-usage.service'
import { ManagedStorageService } from '@core/modules/platform/managed-storage/managed-storage.service'
import { TenantService } from '@core/modules/platform/tenant/tenant.service'
import { Body, Controller, Delete, Get, Param, Patch, Query } from '@tsuki-hono/common'
import { desc, eq } from 'drizzle-orm'

import type { BillingPlanId } from '../billing/billing-plan.types'
import { DataManagementService } from '../data-management/data-management.service'
import {
  ListTenantsQueryDto,
  TenantIdParamDto,
  TenantPhotosQueryDto,
  UpdateTenantBanDto,
  UpdateTenantPlanDto,
  UpdateTenantStoragePlanDto,
} from './super-admin.dto'

@Controller('super-admin/tenants')
@Roles('superadmin')
@BypassResponseTransform()
export class SuperAdminTenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly dataManagementService: DataManagementService,
    private readonly billingPlanService: BillingPlanService,
    private readonly billingUsageService: BillingUsageService,
    private readonly managedStorageService: ManagedStorageService,
    private readonly systemSettings: SystemSettingService,
    private readonly db: DbAccessor,
  ) {}

  @Get('/:tenantId/photos')
  async getTenantPhotos(@Param() params: TenantIdParamDto, @Query() query: TenantPhotosQueryDto) {
    const photos = await this.db
      .get()
      .select()
      .from(photoAssets)
      .where(eq(photoAssets.tenantId, params.tenantId))
      .limit(query.limit)
      .orderBy(desc(photoAssets.createdAt))

    return {
      photos: photos.map((p) => ({
        ...p,
        publicUrl: p.manifest.data.thumbnailUrl,
      })),
    }
  }

  @Get('/')
  async listTenants(@Query() query: ListTenantsQueryDto) {
    const [tenantResult, plans, storagePlanCatalog, managedProviderKey] = await Promise.all([
      this.tenantService.listTenants({
        page: query.page,
        limit: query.limit,
        search: query.search,
        status: query.status,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      Promise.resolve(this.billingPlanService.getPlanDefinitions()),
      this.systemSettings.getStoragePlanCatalog(),
      this.systemSettings.getManagedStorageProviderKey(),
    ])

    const { items: tenantAggregates, total } = tenantResult

    const tenantIds = tenantAggregates.map((aggregate) => aggregate.tenant.id)
    const [usageTotalsMap, storageUsageMap, ownerMap, domainMap] = await Promise.all([
      this.billingUsageService.getUsageTotalsForTenants(tenantIds),
      managedProviderKey && tenantIds.length > 0
        ? this.managedStorageService.getUsageTotalsForTenants(managedProviderKey, tenantIds)
        : Promise.resolve({}),
      this.getOwnerEmailsForTenants(tenantIds),
      this.getVerifiedDomainsForTenants(tenantIds),
    ])

    return {
      tenants: tenantAggregates.map((aggregate) => ({
        ...aggregate.tenant,
        usageTotals: usageTotalsMap[aggregate.tenant.id] ?? [],
        storageUsage: storageUsageMap[aggregate.tenant.id] ?? null,
        ownerEmail: ownerMap[aggregate.tenant.id] ?? null,
        customDomain: domainMap[aggregate.tenant.id] ?? null,
      })),
      plans,
      storagePlans: Object.entries(storagePlanCatalog).map(([id, def]) => ({
        id,
        ...def,
      })),
      total,
    }
  }

  @Get('/storage')
  async listStorageTenants(@Query() query: ListTenantsQueryDto) {
    const [tenantResult, storagePlanCatalog, managedProviderKey] = await Promise.all([
      this.tenantService.listTenants({
        page: query.page,
        limit: query.limit,
        search: query.search,
        status: query.status,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        requireStoragePlan: true,
      }),
      this.systemSettings.getStoragePlanCatalog(),
      this.systemSettings.getManagedStorageProviderKey(),
    ])

    const { items: tenantAggregates, total } = tenantResult
    const tenantIds = tenantAggregates.map((aggregate) => aggregate.tenant.id)

    const storageUsageMap =
      managedProviderKey && tenantIds.length > 0
        ? await this.managedStorageService.getUsageTotalsForTenants(managedProviderKey, tenantIds)
        : {}

    return {
      tenants: tenantAggregates.map((aggregate) => ({
        ...aggregate.tenant,
        storageUsage: storageUsageMap[aggregate.tenant.id] ?? null,
      })),
      plans: [],
      storagePlans: Object.entries(storagePlanCatalog).map(([id, def]) => ({
        id,
        ...def,
      })),
      total,
    }
  }

  @Patch('/:tenantId/plan')
  async updateTenantPlan(@Param() params: TenantIdParamDto, @Body() dto: UpdateTenantPlanDto) {
    await this.billingPlanService.updateTenantPlan(params.tenantId, dto.planId as BillingPlanId)
    return { updated: true }
  }

  @Patch('/:tenantId/storage-plan')
  async updateTenantStoragePlan(@Param() params: TenantIdParamDto, @Body() dto: UpdateTenantStoragePlanDto) {
    await this.tenantService.updateStoragePlan(params.tenantId, dto.storagePlanId)
    return { updated: true }
  }

  @Patch('/:tenantId/ban')
  async updateTenantBan(@Param() params: TenantIdParamDto, @Body() dto: UpdateTenantBanDto) {
    await this.tenantService.setBanned(params.tenantId, dto.banned)
    return { updated: true }
  }

  @Delete('/:tenantId')
  async deleteTenant(@Param() params: TenantIdParamDto) {
    return await this.dataManagementService.deleteTenantAccountById(params.tenantId)
  }

  private async getOwnerEmailsForTenants(tenantIds: string[]): Promise<Record<string, string>> {
    if (tenantIds.length === 0) return {}
    const db = this.db.get()
    const rows = await db
      .select({ tenantId: authUsers.tenantId, email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.role, 'admin'))
    const map: Record<string, string> = {}
    for (const row of rows) {
      if (row.tenantId && !map[row.tenantId]) {
        map[row.tenantId] = row.email
      }
    }
    return map
  }

  private async getVerifiedDomainsForTenants(tenantIds: string[]): Promise<Record<string, string>> {
    if (tenantIds.length === 0) return {}
    const db = this.db.get()
    const rows = await db
      .select({ tenantId: tenantDomains.tenantId, domain: tenantDomains.domain })
      .from(tenantDomains)
      .where(eq(tenantDomains.status, 'verified'))
    const map: Record<string, string> = {}
    for (const row of rows) {
      if (!map[row.tenantId]) {
        map[row.tenantId] = row.domain
      }
    }
    return map
  }
}
