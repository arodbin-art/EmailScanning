export type AssignmentContext = {
  pollCycleId: string
}

export interface AccountAssignmentStrategy {
  resolveAssignedAccounts(context: AssignmentContext): Promise<number[]>
}
