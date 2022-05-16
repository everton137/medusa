import { EntityManager } from "typeorm"
import { BatchJob } from "../models"
import { BatchJobRepository } from "../repositories/batch-job"
import { FilterableBatchJobProps } from "../types/batch-job"
import { FindConfig } from "../types/common"
import { TransactionBaseService } from "../interfaces"
import { buildQuery } from "../utils"

type InjectedDependencies = {
  manager: EntityManager
  batchJobRepository: typeof BatchJobRepository
}

class BatchJobService extends TransactionBaseService<BatchJobService> {
  protected readonly manager_: EntityManager
  protected readonly transactionManager_: EntityManager | undefined
  protected readonly batchJobRepository_: typeof BatchJobRepository

  static readonly Events = {
    CREATED: "batch.created",
    UPDATED: "batch.updated",
    CANCELED: "batch.canceled",
  }

  constructor({ manager, batchJobRepository }: InjectedDependencies) {
    super({ manager, batchJobRepository })

    this.manager_ = manager
    this.batchJobRepository_ = batchJobRepository
  }

  /*
   * if job is started with dry_run: true, then it's required
   * to complete the job before it's written to DB
   */
  async complete(batchJobId: string, userId: string): Promise<BatchJob> {
    return await this.atomicPhase_(async (manager) => {
      // logic...

      const batchJobRepo: BatchJobRepository = manager.getCustomRepository(
        this.batchJobRepository_
      )

      const batchJob = await batchJobRepo.findOne(batchJobId)

      if (!batchJob || batchJob.created_by_id !== userId) {
        // TODO: check if user is admin
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "You cannot complete batch jobs created by other users"
        )
      }

      // check that job has run

      if (batchJob.awaiting_confirmation_at && !batchJob.confirmed_at) {
        batchJob.confirmed_at = new Date()

        await batchJobRepo.save(batchJob)

        const result = (await batchJobRepo.findOne(batchJobId)) as BatchJob

        await this.eventBus_
          .withTransaction(manager)
          .emit(BatchJobService.Events.UPDATED, {
            id: result.id,
          })

        return result
      }

      return batchJob
    })
  }

  async listAndCount(
    selector: FilterableBatchJobProps = {},
    config: FindConfig<BatchJob> = { skip: 0, take: 20 }
  ): Promise<[BatchJob[], number]> {
    return await this.atomicPhase_(
      async (manager: EntityManager): Promise<[BatchJob[], number]> => {
        const batchJobRepo = manager.getCustomRepository(
          this.batchJobRepository_
        )

        const query = buildQuery(selector, config)
        return await batchJobRepo.findAndCount(query)
      }
    )
  }
}

export default BatchJobService
