export class RpcTarget {}

export class WorkerEntrypoint<Bindings = unknown, Props = unknown> {
  env!: Bindings;
  ctx!: { props: Props };
}
