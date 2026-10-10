import { createRemoteServiceEndpoint, type RemoteServiceProvider } from "@earendil-works/chord";
import {
  type RoutedServerServiceAttachment,
  type ServerHost,
  type SessionMetadata,
  SessionNotFoundError,
} from "@earendil-works/pi-server";

/** Services for one client connection. `dispose` runs when the connection's attachment is released. */
export interface ConnectionServices {
  readonly provider: RemoteServiceProvider;
  dispose?(): void;
}

/**
 * A pi-server host that serves every service at server scope, with one service provider per client connection.
 *
 * Tandem does not use pi-server Sessions: there is one Harness for the whole app, so there is nothing to route
 * between. A provider per connection lets each connection own keyed instances, such as the conversations it opened,
 * without other connections receiving their state.
 */
export function createServiceHost(createConnectionServices: () => ConnectionServices): ServerHost<SessionMetadata> {
  return {
    serverServices: {
      attachClient(): RoutedServerServiceAttachment {
        const services = createConnectionServices();
        const endpoint = createRemoteServiceEndpoint(services.provider);
        let released = false;
        return {
          invokeService(call, publish, context) {
            if (released) return Promise.reject(new Error("Connection services are released"));
            return endpoint.invoke(call, publish, context);
          },
          release() {
            if (released) return;
            released = true;
            endpoint.dispose();
            services.provider.dispose();
            services.dispose?.();
          },
        };
      },
    },
    async resolveSession() {
      throw new SessionNotFoundError();
    },
    async openSession() {
      throw new SessionNotFoundError();
    },
  };
}
