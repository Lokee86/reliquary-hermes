//! HACK for the existing Gateway delivery gate.
//!
//! Remove this module and its bridge-specific tests when Root records retrieval
//! when its query agents return selected Memories. The adapter is private to one
//! selected return and synthesizes only the exact receipt supplied to that gate.

use reliquary_memory::{
    CapabilityRouter, HandoffReceipt, HostAdmissionAdapter, HostCancelOutcome,
    HostCapabilityContract, HostConnection, HostOperation, HostOperationStatus,
    HostQueueGuarantees, HostReconcileStatus, Instance, MemoryDeliveryOperation,
    MemoryDeliveryReceipt, MemoryDeliveryStatus, PreparedMemoryDelivery, ProductError,
    ProductErrorKind, RetrievalPreview, RetrievalSession, RuntimeCapability, TrustedHostAdapter,
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex, OnceLock},
};

/// The outcome of returning one exact, Root-prepared selection.
#[derive(Debug)]
pub enum ReturnOutcome<'a> {
    Returned {
        delivery_id: &'a str,
        selection: &'a RetrievalPreview,
    },
    AlreadyRecorded,
}

/// One authorized selection staged for return. Keep this value to retry an
/// ambiguous in-process write with the same exact operation.
pub struct SelectedReturn<'a> {
    instance: &'a Instance,
    session: &'a RetrievalSession,
    prepared: &'a PreparedMemoryDelivery,
    selection: RetrievalPreview,
    router: CapabilityRouter,
    recorded: Mutex<bool>,
}

impl<'a> SelectedReturn<'a> {
    /// Stage the exact selection without recording a use. If the projection
    /// is truncated, the caller can cancel the pending turn through Root.
    pub fn new(
        admission: &HostAdmissionAdapter,
        instance: &'a Instance,
        session: &'a RetrievalSession,
        prepared: &'a PreparedMemoryDelivery,
    ) -> Result<Self, ProductError> {
        let selection = instance.preview_retrieval(session, prepared)?;
        // Root's preview comes from the same evaluation as its exact delivery
        // manifest. Never credit the full selection for a truncated projection.
        if selection.truncated {
            return Err(ProductError::new(
                ProductErrorKind::Unavailable,
                "selected Memory content exceeds the bounded return projection",
            ));
        }
        let adapter = Arc::new(ExactReceipt {
            delivery_id: prepared.stable_id().to_owned(),
            operation: OnceLock::new(),
        });
        Ok(Self {
            instance,
            session,
            prepared,
            selection,
            router: admission.connect_runtime_host(adapter),
            recorded: Mutex::new(false),
        })
    }

    /// Record through Root before releasing selected content. A duplicate
    /// returns status only, so a cached selection cannot be released again
    /// after its cut has changed.
    pub fn return_selected(&self) -> Result<ReturnOutcome<'_>, ProductError> {
        let mut recorded = self.recorded.lock().map_err(|_| {
            ProductError::new(
                ProductErrorKind::Conflict,
                "selected return state is unavailable",
            )
        })?;
        if !*recorded {
            // A pending retry may use the cached synthetic receipt and bypass
            // Gateway's initial cut check. Check the cut before retrying.
            self.instance
                .preview_retrieval(self.session, self.prepared)?;
        }
        let newly_recorded =
            self.instance
                .deliver_retrieval(self.session, self.prepared, &self.router)?;
        *recorded = true;
        if newly_recorded {
            Ok(ReturnOutcome::Returned {
                delivery_id: self.prepared.stable_id(),
                selection: &self.selection,
            })
        } else {
            Ok(ReturnOutcome::AlreadyRecorded)
        }
    }
}

struct ExactReceipt {
    delivery_id: String,
    operation: OnceLock<MemoryDeliveryOperation>,
}

const CAPABILITY: RuntimeCapability = RuntimeCapability::MemoryDelivery;

impl TrustedHostAdapter for ExactReceipt {
    fn configured_capabilities(&self) -> BTreeSet<RuntimeCapability> {
        [CAPABILITY].into()
    }

    fn connect(&self) -> Result<HostConnection, String> {
        Ok(HostConnection {
            capabilities: [(
                CAPABILITY,
                HostCapabilityContract::pending_queue(self.queue_guarantees(CAPABILITY)),
            )]
            .into(),
        })
    }

    fn queue_guarantees(&self, capability: RuntimeCapability) -> HostQueueGuarantees {
        if capability != CAPABILITY {
            return HostQueueGuarantees::default();
        }
        // HACK scoped to the synchronous selected-return gate. There is no
        // external queue or durable side effect before Root commits accepted
        // use. The REL receipt is the durable authority after that commit.
        HostQueueGuarantees {
            durable_acceptance: true,
            stable_submission_ids: true,
            linearizable_cancel_dequeue: true,
            queryable_operation_status: true,
            idempotent_handoff: true,
        }
    }

    fn reconcile(&self, _: RuntimeCapability) -> Result<HostReconcileStatus, String> {
        Ok(HostReconcileStatus::NoOutstandingWork)
    }

    fn handoff(&self, _: RuntimeCapability, _: &HostOperation) -> Result<HandoffReceipt, String> {
        Err("selected return does not support queue handoff".into())
    }

    fn status(&self, _: RuntimeCapability, _: &str) -> Result<HostOperationStatus, String> {
        Ok(HostOperationStatus::Unknown)
    }

    fn cancel(&self, _: RuntimeCapability, _: &str) -> Result<HostCancelOutcome, String> {
        Ok(HostCancelOutcome::Unknown)
    }

    fn deliver_memory(
        &self,
        operation: &MemoryDeliveryOperation,
    ) -> Result<MemoryDeliveryReceipt, String> {
        let actual_digest: [u8; 32] = Sha256::digest(&operation.payload).into();
        if operation.stable_id != self.delivery_id || operation.payload_digest != actual_digest {
            return Err("selected return received mismatched delivery evidence".into());
        }
        if self.operation.get_or_init(|| operation.clone()) != operation {
            return Err("selected return already holds different delivery evidence".into());
        }
        Ok(MemoryDeliveryReceipt {
            stable_id: operation.stable_id.clone(),
            payload_digest: operation.payload_digest,
            confirmed_consumption: true,
        })
    }

    fn memory_delivery_status(&self, stable_id: &str) -> Result<MemoryDeliveryStatus, String> {
        if stable_id != self.delivery_id {
            return Ok(MemoryDeliveryStatus::Unknown);
        }
        Ok(self.operation.get().cloned().map_or(
            MemoryDeliveryStatus::NotFound,
            MemoryDeliveryStatus::Confirmed,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn operation(id: &str, payload: &[u8]) -> MemoryDeliveryOperation {
        MemoryDeliveryOperation {
            stable_id: id.into(),
            payload_digest: Sha256::digest(payload).into(),
            payload: payload.to_vec(),
        }
    }

    #[test]
    fn synthetic_receipt_binds_one_exact_id_and_manifest() {
        let adapter = ExactReceipt {
            delivery_id: "selected".into(),
            operation: OnceLock::new(),
        };
        let exact = operation("selected", b"exact Root manifest");
        let mut corrupt = exact.clone();
        corrupt.payload.push(0);
        assert!(adapter.deliver_memory(&corrupt).is_err());
        assert!(
            adapter
                .deliver_memory(&operation("foreign", &exact.payload))
                .is_err()
        );
        assert_eq!(
            adapter.memory_delivery_status("selected").unwrap(),
            MemoryDeliveryStatus::NotFound
        );

        let receipt = adapter.deliver_memory(&exact).unwrap();
        assert!(receipt.confirmed_consumption);
        assert_eq!(receipt.stable_id, exact.stable_id);
        assert_eq!(receipt.payload_digest, exact.payload_digest);
        assert_eq!(adapter.deliver_memory(&exact).unwrap(), receipt);
        assert!(
            adapter
                .deliver_memory(&operation("selected", b"different manifest"))
                .is_err()
        );
        assert_eq!(
            adapter.memory_delivery_status("selected").unwrap(),
            MemoryDeliveryStatus::Confirmed(exact)
        );
        assert_eq!(
            adapter.memory_delivery_status("foreign").unwrap(),
            MemoryDeliveryStatus::Unknown
        );
    }
}
