import { RemoteServiceError } from "@earendil-works/chord";

/**
 * A rejection the client sees with its message. pi-server forwards only service and server errors; any other error
 * reaches the client as "Internal server error" and is reported to the server's `onError`.
 */
export function invalidInput(message: string): RemoteServiceError {
  return new RemoteServiceError("service_invalid_value", message);
}
