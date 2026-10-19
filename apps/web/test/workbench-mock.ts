/**
 * What a test that renders one component gives in place of the workbench: every hook the component may read answers
 * from one shape, which names what the test lets it find.
 */
export function workbenchMock(shape: () => Record<string, unknown>, extras: Record<string, unknown> = {}) {
  return {
    useWorkbench: shape,
    usePanelNavigation: shape,
    useProjectResources: () => ({ files: shape().projectFiles, comments: shape().comments }),
    useOpenWorkspaceId: () => shape().workspaceId ?? null,
    ...extras,
  };
}
