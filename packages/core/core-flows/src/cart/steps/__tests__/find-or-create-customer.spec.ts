import { MedusaContainer } from "@medusajs/framework/types"
import { createMedusaContainer, Modules } from "@medusajs/framework/utils"
import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  findOrCreateCustomerStep,
  FindOrCreateCustomerStepInput,
} from "../find-or-create-customer"

type Customer = {
  id: string
  email: string
  has_account: boolean
  groups: { id: string }[]
}

const member: Customer = {
  id: "cus_member",
  email: "member@example.com",
  has_account: true,
  groups: [{ id: "cusgroup_vip" }],
}

const workflow = createWorkflow(
  "find-or-create-customer-step-spec",
  (input: WorkflowData<FindOrCreateCustomerStepInput>) => {
    return new WorkflowResponse(findOrCreateCustomerStep(input))
  }
)

describe("findOrCreateCustomerStep", () => {
  let customers: Customer[]
  let service: {
    listCustomers: jest.Mock
    retrieveCustomer: jest.Mock
    createCustomers: jest.Mock
    deleteCustomers: jest.Mock
  }
  let container: MedusaContainer

  beforeEach(() => {
    customers = [member]
    service = {
      listCustomers: jest.fn(async (filters: Record<string, unknown>) =>
        customers.filter((customer) =>
          Object.entries(filters).every(
            ([key, value]) => (customer as any)[key] === value
          )
        )
      ),
      retrieveCustomer: jest.fn(async (id: string) =>
        customers.find((customer) => customer.id === id)
      ),
      createCustomers: jest.fn(async (data: { email: string }) => {
        const created = {
          id: `cus_guest_${customers.length}`,
          has_account: false,
          groups: [],
          ...data,
        }
        customers.push(created)
        return created
      }),
      deleteCustomers: jest.fn(),
    }

    container = createMedusaContainer() as unknown as MedusaContainer
    container.register(Modules.CUSTOMER, { resolve: () => service } as any)
  })

  const run = async (input: FindOrCreateCustomerStepInput) => {
    const { result } = await workflow(container).run({ input })
    return result
  }

  it("finds a registered customer by email for callers that trust the email", async () => {
    const result = await run({ email: member.email })

    expect(result.customer?.id).toEqual(member.id)
    expect(result.customer?.has_account).toBe(true)
    expect(service.createCustomers).not.toHaveBeenCalled()
  })

  it("does not attach a registered customer to an email nobody authenticated for", async () => {
    const result = await run({ email: member.email, onlyGuestByEmail: true })

    expect(result.customer?.id).not.toEqual(member.id)
    expect(result.customer?.has_account).toBe(false)
    expect(result.customer?.groups).toEqual([])
    expect(service.createCustomers).toHaveBeenCalledWith({
      email: member.email,
    })
    expect(service.listCustomers).toHaveBeenCalledWith(
      { email: member.email, has_account: false },
      expect.anything()
    )
  })

  it("reuses an existing guest record for that email", async () => {
    const guest: Customer = {
      id: "cus_guest",
      email: member.email,
      has_account: false,
      groups: [],
    }
    customers = [member, guest]

    const result = await run({ email: member.email, onlyGuestByEmail: true })

    expect(result.customer?.id).toEqual(guest.id)
    expect(service.createCustomers).not.toHaveBeenCalled()
  })

  it("keeps the authenticated customer when a customer id is given", async () => {
    const result = await run({
      customerId: member.id,
      email: member.email,
      onlyGuestByEmail: true,
    })

    expect(result.customer?.id).toEqual(member.id)
    expect(service.createCustomers).not.toHaveBeenCalled()
  })
})
