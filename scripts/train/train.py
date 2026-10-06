import numpy as np, json, sys
from sklearn.datasets import load_svmlight_file
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
HASH = 1 << 18; NDENSE = 20; NF = HASH + NDENSE; D = "data/"
def load(n):
    X, y = load_svmlight_file(D + n + ".svm", n_features=NF, zero_based=False); return X.tocsr(), y
X, y = load("train2")
dense = X[:, HASH:].toarray(); mu, sd = dense.mean(0), dense.std(0) + 1e-6
def prep(X):
    X = X.copy().tocsc()
    for k in range(NDENSE):
        s, e = X.indptr[HASH + k], X.indptr[HASH + k + 1]
        X.data[s:e] = (X.data[s:e] - mu[k]) / sd[k] * 0.3
    return X.tocsr()
# Human texts weigh more so mistakes on people cost more than missed AI text.
w = np.where(y == 0, 1.5, 1.0)
clf = LogisticRegression(C=float(sys.argv[1]), solver="liblinear", max_iter=300).fit(prep(X), y, sample_weight=w)
np.save("model_final.npy", np.concatenate([clf.coef_[0], clf.intercept_])); np.save("dense_norm.npy", np.stack([mu, sd]))
probs = {}
for n in ["mage-test", "test_ood_set_gpt", "test_ood_set_gpt_para", "hape-test", "brown-abc", "claude", "raid"]:
    Xt, yt = load("test-" + n); p = clf.predict_proba(prep(Xt))[:, 1]; probs[n] = (p, yt)
    print(n.ljust(24), "auc", round(roc_auc_score(yt, p), 4) if len(set(yt)) > 1 else "-")
np.save("probs.npy", {k: (v[0], v[1]) for k, v in probs.items()}, allow_pickle=True)
