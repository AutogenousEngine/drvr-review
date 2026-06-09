/**
 * Ambient type references for standalone typechecking.
 *
 * Pulls in Next.js's global type augmentation — specifically the
 * `RequestInit.next` field (`{ next: { revalidate, tags } }`) used by
 * `validateReviewToken`'s fetch call. In a consuming Next app this comes for
 * free via the generated `next-env.d.ts`; here we reference it explicitly so
 * `tsc --noEmit` passes outside of a Next project.
 */
/// <reference types="next" />
/// <reference types="next/types/global" />
