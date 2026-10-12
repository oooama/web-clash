// The two modal dialogs (add profile / edit profile).
export function showDlg(){document.getElementById('dlg').classList.add('show');}

export function closeDlg(){document.getElementById('dlg').classList.remove('show');}

export function closeEditDlg(){document.getElementById('editDlg').classList.remove('show');}

/** Open the edit-profile dialog (values are filled in by the caller). */
export function showEditDlg() {
    document.getElementById('editDlg').classList.add('show');
}
