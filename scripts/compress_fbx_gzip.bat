cd "..\magia-exedra-character-three\models"

for /R %%F in ("*fbx") do (
    7z a -tgzip %%F.gz %%F
)

cd "..\..\scripts"
