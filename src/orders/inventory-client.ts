import type {
  ProcessOrderItemRequest,
  ProcessOrderItemResponse
} from "../generated/inventoryserviceapi/processorderitem/processorderitem_pb.js";
import { UnaryClientPool } from "../common/grpc.js";
import { InventoryServiceApi } from "../generated/inventoryserviceapi/inventoryserviceapi.generated_pb.js";
import type { InventoryClient } from "./service.js";

export class GrpcInventoryClient implements InventoryClient {
  readonly #pool: UnaryClientPool;

  public constructor(address: string, connections: number) {
    this.#pool = new UnaryClientPool(address, connections, InventoryServiceApi);
  }

  public processOrderItem(
    request: ProcessOrderItemRequest,
    deadline: number,
    signal: AbortSignal
  ): Promise<ProcessOrderItemResponse> {
    return this.#pool.unary<ProcessOrderItemResponse>(
      InventoryServiceApi.method.processOrderItem,
      request,
      deadline,
      signal
    );
  }

  public close(): void {
    this.#pool.close();
  }
}
