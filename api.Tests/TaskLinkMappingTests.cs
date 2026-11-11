using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DMS.Api.Tests;

public class TaskLinkMappingTests
{
    [Fact]
    public void Task_link_models_declare_their_parent_task_foreign_keys()
    {
        // Building the EF model needs a provider, but this test never opens a
        // connection or reads/writes data.
        var options = new DbContextOptionsBuilder<DmsContext>()
            .UseNpgsql("Host=localhost;Database=dms;Username=dms;Password=not-used")
            .Options;
        using var context = new DmsContext(options);

        var documentLinks = context.Model.FindEntityType(typeof(DmsTaskDocumentLink))!.GetForeignKeys();
        var folderLinks = context.Model.FindEntityType(typeof(DmsTaskFolderLink))!.GetForeignKeys();

        Assert.Contains(documentLinks, foreignKey => foreignKey.PrincipalEntityType.ClrType == typeof(DmsTask));
        Assert.Contains(folderLinks, foreignKey => foreignKey.PrincipalEntityType.ClrType == typeof(DmsTask));
    }
}
