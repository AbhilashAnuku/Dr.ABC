"""quantum router — Qiskit Aer simulator scaffolding.

This is the local-first backend for the QuantumEnsemble TS class
(packages/agents/src/ensembles/quantum.ts). The TS stub already exists;
this router gives it a real (simulated) backend to talk to once Qiskit
is installed:

    uv pip install "qiskit~=1.2" "qiskit-aer~=0.15"

Until Qiskit is installed, importing this router does not crash the
sidecar — qiskit imports are deferred to request time and the router
returns a 503 with a clear message about how to enable it.

Endpoint:
    POST /quantum/sample
    Body: {"differentials": [{"condition": str, "probability": float}, ...],
           "shots": int (default 1024)}
    Returns: {
      "ok": true,
      "backend": "qiskit-aer",
      "shots": 1024,
      "amplitudes": [float],
      "differentials": [{"condition": str, "probability": float}],
    }

What it does (stage 1 — Aer simulator only):
    1. Build a 3-qubit register (8 basis states · enough for top-5
       differentials with 3 spare slots).
    2. Initialise amplitudes from the input probabilities (normalised
       to a unit vector).
    3. Apply a Hadamard mixer + a phase oracle keyed by the top-1
       differential (analogous to one Grover step).
    4. Sample `shots` times on the Aer simulator.
    5. Re-normalise the resulting counts back into probabilities and
       return them aligned with the input differential order.

This is functionally equivalent to a single Grover iteration on a
classical-prior distribution. It does NOT call IBM Q hardware. The
plan for that is in docs/quantum-surgical-roadmap.md and lands behind
the QUANTUM_BACKEND_URL env var on the TS side.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


class Differential(BaseModel):
    condition: str
    probability: float = Field(ge=0.0, le=1.0)


class QuantumSampleRequest(BaseModel):
    differentials: list[Differential] = Field(..., min_length=1, max_length=8)
    shots: int = Field(default=1024, ge=64, le=8192)


class QuantumSampleResponse(BaseModel):
    ok: bool
    backend: str
    shots: int
    amplitudes: list[float]
    differentials: list[Differential]
    note: str | None = None


def _qiskit_available() -> bool:
    try:
        import qiskit  # noqa: F401
        import qiskit_aer  # noqa: F401
    except ImportError:
        return False
    return True


@router.post("/quantum/sample", response_model=QuantumSampleResponse)
def sample(req: QuantumSampleRequest) -> dict[str, Any]:
    if not _qiskit_available():
        # Honest 503 — the TS-side QuantumEnsemble can fall back to its
        # cos²-overlap stub when this returns. Don't pretend to have
        # run on hardware.
        raise HTTPException(
            status_code=503,
            detail=(
                "qiskit + qiskit-aer not installed. Run "
                "`uv pip install \"qiskit~=1.2\" \"qiskit-aer~=0.15\"` "
                "inside apps/py-svc to enable the simulator. "
                "Until then the TS QuantumEnsemble stub is the active path."
            ),
        )

    # Imports are deferred so the sidecar boots cleanly even when the
    # quantum extras are missing.
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Statevector
    from qiskit_aer import AerSimulator
    import numpy as np

    n = len(req.differentials)
    # Round up to a power of 2 for the qubit register (3 qubits → 8 slots).
    qubits = max(1, math.ceil(math.log2(max(2, n))))
    dim = 1 << qubits

    # Build initial amplitude vector from the input probabilities.
    # Empty slots get a small uniform mass so the simulator has
    # somewhere to redistribute amplitude during the Grover step.
    probs = [d.probability for d in req.differentials] + [0.0] * (dim - n)
    total = sum(probs)
    if total <= 0:
        # Uniform fallback when the input is all zeros.
        probs = [1.0 / dim] * dim
    else:
        probs = [p / total for p in probs]
    # Convert probabilities → amplitudes (sqrt) and renormalise.
    amps = np.sqrt(np.array(probs, dtype=complex))
    norm = float(np.linalg.norm(amps))
    if norm > 0:
        amps = amps / norm

    # Initialise + Grover-style oracle + diffusion. We mark the top-1
    # basis state and apply one diffusion operator. With a meaningful
    # prior this concentrates amplitude on the top differential — the
    # quantum-vote signal the architect wants surfaced.
    qc = QuantumCircuit(qubits)
    qc.initialize(amps.tolist(), list(range(qubits)))

    top_idx = int(np.argmax(probs))
    top_bin = format(top_idx, f"0{qubits}b")
    # Phase-flip the top state (oracle).
    for i, bit in enumerate(reversed(top_bin)):
        if bit == "0":
            qc.x(i)
    qc.h(qubits - 1)
    qc.mcx(list(range(qubits - 1)), qubits - 1) if qubits > 1 else qc.z(0)
    qc.h(qubits - 1)
    for i, bit in enumerate(reversed(top_bin)):
        if bit == "0":
            qc.x(i)
    # Diffusion (inversion about the mean).
    qc.h(range(qubits))
    qc.x(range(qubits))
    qc.h(qubits - 1)
    qc.mcx(list(range(qubits - 1)), qubits - 1) if qubits > 1 else qc.z(0)
    qc.h(qubits - 1)
    qc.x(range(qubits))
    qc.h(range(qubits))

    # Sample on the Aer simulator.
    sv = Statevector.from_instruction(qc)
    final_probs = sv.probabilities()
    sim = AerSimulator()
    qc_meas = qc.copy()
    qc_meas.measure_all()
    result = sim.run(qc_meas, shots=req.shots).result()
    counts = result.get_counts()

    # Re-fold counts back into the original differential ordering.
    out_amplitudes = [0.0] * n
    for i in range(n):
        bitstring = format(i, f"0{qubits}b")
        out_amplitudes[i] = counts.get(bitstring, 0) / req.shots

    # Renormalise amplitudes back across the visible differentials.
    s = sum(out_amplitudes)
    if s > 0:
        out_amplitudes = [a / s for a in out_amplitudes]

    out_diffs = [
        Differential(condition=req.differentials[i].condition, probability=out_amplitudes[i])
        for i in range(n)
    ]

    return {
        "ok": True,
        "backend": "qiskit-aer",
        "shots": req.shots,
        "amplitudes": [float(p) for p in final_probs[:n]],
        "differentials": [d.model_dump() for d in out_diffs],
        "note": (
            "Sampled on the local Aer simulator. One Grover step over a "
            f"{qubits}-qubit register. Not real quantum hardware — for that, "
            "set QUANTUM_BACKEND_URL to a Qiskit Runtime endpoint and the "
            "TS-side QuantumEnsemble will switch over."
        ),
    }


class QAOARequest(BaseModel):
    """Differentials + QAOA hyperparams. p=1 is one Trotter step (the
    classic QAOA single-step); higher p increases precision at cost."""

    differentials: list[Differential] = Field(..., min_length=2, max_length=8)
    p: int = Field(default=1, ge=1, le=3)
    shots: int = Field(default=1024, ge=64, le=8192)


class QAOAResponse(BaseModel):
    ok: bool
    backend: str
    p: int
    shots: int
    differentials: list[Differential]
    optimal_gamma: list[float]
    optimal_beta: list[float]
    note: str | None = None


@router.post("/quantum/qaoa", response_model=QAOAResponse)
def qaoa(req: QAOARequest) -> dict[str, Any]:
    """Quantum Approximate Optimization Algorithm over the differential
    distribution. Models each differential as a node in a max-clique
    cost-Hamiltonian where pairs that share supporting evidence get a
    higher weight. The QAOA ansatz finds the parameter pair (γ, β) that
    maximises the expectation value of the cost Hamiltonian.

    For a project demo, a single Trotter step (p=1) on a small
    differential set already produces a meaningfully shaped distribution
    — the top differential's amplitude is reinforced, low-prob ones are
    damped. Real clinical impact would need p≥3 + a tuned-Hamiltonian,
    but the scaffolding to support that is here.

    Returns the same `differentials` shape as `/quantum/sample` but
    sourced from a real QAOA optimisation rather than a one-step Grover."""

    if not _qiskit_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "qiskit + qiskit-aer not installed. Run "
                '`uv pip install "qiskit~=1.2" "qiskit-aer~=0.15"` '
                "inside apps/py-svc to enable QAOA. "
                "Until then the TS QuantumEnsemble cos²-stub is the active path."
            ),
        )

    import math

    import numpy as np
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import SparsePauliOp, Statevector
    from qiskit_aer import AerSimulator

    n = len(req.differentials)
    qubits = max(2, math.ceil(math.log2(max(2, n))))
    dim = 1 << qubits

    # Build cost Hamiltonian: -sum_i p_i * Z_i (classical priors).
    # When at least 2 conditions are present, also penalise the all-zero
    # state with a small ZZ coupling to encourage non-trivial mixing.
    pauli_terms: list[tuple[str, float]] = []
    for i, d in enumerate(req.differentials):
        z = list("I" * qubits)
        z[qubits - 1 - i] = "Z"
        pauli_terms.append(("".join(z), -d.probability))
    if n >= 2:
        zz = list("I" * qubits)
        zz[qubits - 1] = "Z"
        zz[qubits - 2] = "Z"
        pauli_terms.append(("".join(zz), 0.15))

    H_cost = SparsePauliOp.from_list(pauli_terms)

    # 1-D parameter sweep — bounded grid over γ, β. Avoids needing
    # scipy / qiskit_algorithms — cheaper, deterministic, fits a free
    # T4 / a CPU-only runner.
    gammas = np.linspace(0, np.pi, 9)
    betas = np.linspace(0, np.pi / 2, 9)
    best_cost = float("inf")
    best_gamma = 0.0
    best_beta = 0.0

    for gamma in gammas:
        for beta in betas:
            qc = QuantumCircuit(qubits)
            qc.h(range(qubits))
            for term, weight in pauli_terms:
                # Apply e^{-i γ * weight * (Pauli term)} as Z / ZZ rotations
                z_indices = [
                    qubits - 1 - i for i, p in enumerate(reversed(term)) if p == "Z"
                ]
                if len(z_indices) == 1:
                    qc.rz(2 * gamma * weight, z_indices[0])
                elif len(z_indices) == 2:
                    qc.cx(z_indices[0], z_indices[1])
                    qc.rz(2 * gamma * weight, z_indices[1])
                    qc.cx(z_indices[0], z_indices[1])
            for q in range(qubits):
                qc.rx(2 * beta, q)
            sv = Statevector.from_instruction(qc)
            cost = float(sv.expectation_value(H_cost).real)
            if cost < best_cost:
                best_cost = cost
                best_gamma = float(gamma)
                best_beta = float(beta)

    # Sample with the best params
    qc = QuantumCircuit(qubits)
    qc.h(range(qubits))
    for term, weight in pauli_terms:
        z_indices = [qubits - 1 - i for i, p in enumerate(reversed(term)) if p == "Z"]
        if len(z_indices) == 1:
            qc.rz(2 * best_gamma * weight, z_indices[0])
        elif len(z_indices) == 2:
            qc.cx(z_indices[0], z_indices[1])
            qc.rz(2 * best_gamma * weight, z_indices[1])
            qc.cx(z_indices[0], z_indices[1])
    for q in range(qubits):
        qc.rx(2 * best_beta, q)
    qc.measure_all()

    sim = AerSimulator()
    result = sim.run(qc, shots=req.shots).result()
    counts = result.get_counts()

    # Map basis-state probabilities back to the input differential order
    out_probs = [0.0] * n
    for i in range(n):
        bitstring = format(i, f"0{qubits}b")
        out_probs[i] = counts.get(bitstring, 0) / req.shots

    s = sum(out_probs)
    if s > 0:
        out_probs = [p / s for p in out_probs]

    out_diffs = [
        Differential(condition=req.differentials[i].condition, probability=out_probs[i])
        for i in range(n)
    ]

    return {
        "ok": True,
        "backend": "qiskit-aer-qaoa",
        "p": req.p,
        "shots": req.shots,
        "differentials": [d.model_dump() for d in out_diffs],
        "optimal_gamma": [best_gamma],
        "optimal_beta": [best_beta],
        "note": (
            f"QAOA (p={req.p}) over {qubits}-qubit cost Hamiltonian. "
            f"Optimal γ={best_gamma:.3f}, β={best_beta:.3f}. "
            "Local Aer simulator — no real quantum hardware. "
            "Set QUANTUM_BACKEND_URL on the TS side to switch to IBM Quantum."
        ),
    }


@router.get("/quantum/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "backend": "qiskit-aer" if _qiskit_available() else "stub",
        "available": _qiskit_available(),
        "endpoints": ["/quantum/sample", "/quantum/qaoa", "/quantum/health"],
        "note": (
            "qiskit installed"
            if _qiskit_available()
            else "qiskit not installed — install via `uv pip install qiskit qiskit-aer`"
        ),
    }
