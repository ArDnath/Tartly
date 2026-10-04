/**
 * The `@modal` slot renders nothing unless a soft navigation matches an
 * intercepted route. A hard load of `/settings/*` therefore falls back to the
 * full-page settings route, while in-app clicks open the modal.
 */
export default function ModalDefault() {
  return null;
}
