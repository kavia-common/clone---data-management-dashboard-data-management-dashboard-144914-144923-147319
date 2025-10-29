import React from "react";
import Modal from "./ui/Modal.jsx";
import { renderCreditsWithUsd } from "../utils/currency";

/**
 * PUBLIC_INTERFACE
 * CreditBreakdownModal
 * Shows a detailed credit/cost breakdown per user across projects or per project across users.
 */
// PUBLIC_INTERFACE
export default function CreditBreakdownModal({ open, onClose, title = "Credit Breakdown", breakdown = [] }) {
  /** Accessible modal that renders a summary table from a breakdown array: [{ projectId, projectName, totalCost, totalMinutes }] */
  return (
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button className="btn-modal-close" onClick={onClose}>Close</button>
        </div>
      }
    >
      <div className="table-wrapper">
        {/* Ensure both vertical and horizontal scrolling are available for wide tables */}
        <div className="table-scroll" role="region" aria-label="Credit breakdown table">
          <table className="table">
            <thead>
              <tr>
                <th className="th">Project</th>
                <th className="th">Total Credits</th>
                <th className="th">Total Minutes</th>
              </tr>
            </thead>
            <tbody>
              {!breakdown?.length && (
                <tr className="tr">
                  <td className="td" colSpan={3}>
                    <div className="table-empty">No breakdown available</div>
                  </td>
                </tr>
              )}
              {breakdown?.map((b, idx) => (
                <tr className="tr" key={b.projectId || b.project_id || idx}>
                  <td className="td">{b.projectName || b.project_name || b.projectId || b.project_id || "—"}</td>
                  <td className="td num">
                    {typeof b.totalCost === "number" ? (
                      renderCreditsWithUsd(b.totalCost, { maximumFractionDigits: 8 })
                    ) : "—"}
                  </td>
                  <td className="td num">
                    {typeof b.totalMinutes === "number" ? b.totalMinutes.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
